import { log, serverConfig, shuffleArray } from './utils.js'
import Build from './build.js'
import Repo from './repo.js'
import MedAss from './medass.js'

export default class Runner {
	maxJobs = 2
	currentJobs = []
	queuedJobs = []

	getBuildByServerId(serverId) {
		const job = this.currentJobs.find((job) => job.serverId === serverId)
		return job ? job.build : null
	}

	addToQueue(serverId, opts) {
		this.queuedJobs.push({ serverId, opts })
	}

	removeFromQueue(serverId) {
		this.queuedJobs = this.queuedJobs.filter(e => e.serverId !== serverId)
	}

	onBuildComplete(serverId, cancelled) {
		this.currentJobs = this.currentJobs.filter((job) => job.serverId !== serverId)

		// Avoid building the same server again if we cancelled a build for it
		if (cancelled) {
			const sameServerQueuedJob = this.queuedJobs.find((job) => job.serverId === serverId)
			if (sameServerQueuedJob) {
				this.removeFromQueue(serverId)
			}
		}

		// Trigger any queued items now
		if (this.queuedJobs.length) {
			for (const queuedJob of this.queuedJobs) {
				const qServerId = queuedJob.serverId
				// Already building this server
				if (this.currentJobs.find((job) => job.serverId === qServerId)) continue
				// Remove the queued job, and trigger it
				log(`Triggering queued job for ${serverId}. ${JSON.stringify(this.queuedJobs)}`)
				this.removeFromQueue(qServerId)
				this.build(qServerId, queuedJob.opts)
				break
			}
		}
	}

	build(serverId, opts) {
		log(`Building ${serverId} with ${JSON.stringify(opts)}`)

		// Queue this server for a build if we're already building it
		if (this.currentJobs.find((job) => job.serverId === serverId)) {
			if (!this.queuedJobs.find(e => e.serverId === serverId)) {
				log(`Queueing ${serverId} for a build as it's already being built. ${JSON.stringify(this.queuedJobs)}`)
				this.addToQueue(serverId, opts)
			} else {
				log(`Already building ${serverId} and it's already queued. Stop building me!! ${JSON.stringify(this.queuedJobs)}`)
			}
			return
		}

		const NewBuild = new Build(serverId, opts)
		this.currentJobs.push({ serverId, build: NewBuild })

		try {
			NewBuild.run()
		} catch (e) {
			MedAss.sendBuildComplete({
				server: serverId,
				error: e.message
			})
		}

		NewBuild.on('complete', (cancelled) => {
			this.onBuildComplete(serverId, cancelled)
		})
	}

	run() {
		if (this.currentJobs.length >= this.maxJobs) {
			log('Already running max jobs, aborting.')
			return
		}

		const servers = Object.entries(serverConfig.servers)
		shuffleArray(servers) // shuffle for fun

		for (const [id, server] of servers) {
			if (!server.active) continue

			let NewRepo
			try {
				NewRepo = new Repo(id)
			} catch (e) {
				log(e.message)
				continue
			}

			if (NewRepo.getBranch().startsWith('testmerge-')) {
				// Busy doing a testmerge, ignore it
				continue
			}

			NewRepo.fetch()
			const currentHash = NewRepo.getCurrentLocalHash()
			const latestHash = NewRepo.getLatestOriginHash()
			if (currentHash !== latestHash) {
				// Repo has updates, needs a build
				this.build(id)
			}

			if (this.currentJobs.length >= this.maxJobs) {
				log('Reached max compile jobs.')
				break
			}
		}
	}
}
