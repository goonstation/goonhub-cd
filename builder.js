import fs from 'fs'
import { exec, execSync } from 'child_process'
import config from './config.js'
import { shuffleArray } from './utilities.js'
import Repo from './repo.js'
import MedAss from './medass.js'

const debug = true

export default class Builder {
	constructor() {
		this.maxCompileJobs = 2
		this.currentCompileJobs = []
		this.queuedJobs = []
		this.serversFolder = '/ss13_servers'
	}

	log(msg) {
		if (!debug) return
		const now = (new Date()).toISOString().slice(0, 19).replace(/-/g, "/").replace("T", " ")
		const out = `[${now}] ${msg}`
		console.log(out)
		fs.appendFile('logs/build.log', `${out}\n`, err => {})
	}
	
	getConfig() {
		const file = fs.readFileSync('/ss13_servers.conf')
		return JSON.parse(file)
	}

	getRepoFolder(server) {
		return `${this.serversFolder}/${server}/repo`
	}

	setMapOverride(server, map) {
		return fs.writeFileSync(`${this.serversFolder}/${server}/mapoverride`, map.toUpperCase())
	}

	getBranch(server, branch) {
		const repoFolder = this.getRepoFolder(server)
		if (!fs.existsSync(repoFolder)) throw new Error('That server does not exist')
		return Repo.getBranch(repoFolder).trim()
	}

	switchBranch(server, branch) {
		const repoFolder = this.getRepoFolder(server)
		if (!fs.existsSync(repoFolder)) throw new Error('That server does not exist')
		Repo.fetch(repoFolder)
		if (Repo.doesBranchExist(repoFolder, branch).trim() === '0') {
			throw new Error('That branch does not exist')
		}
		Repo.checkout(repoFolder, branch)
		Repo.clean(repoFolder)
		Repo.update(repoFolder)
	}

	build(server, opts) {
		opts = {
			skipNotifier: false,
			skipCdn: false,
			fetchRepo: false,
			mapSwitch: false,
			...opts
		}
		this.log(`Building ${server}`)
		
		// Queue this server for a build if we're already building it
		if (this.currentCompileJobs.includes(server)) {
			if (!this.queuedJobs.find(e => e.server === server)) {
				this.log(`Queueing ${server} for a build as it's already being built. ${JSON.stringify(this.queuedJobs)}`)
				this.queuedJobs.push({ server, opts })
			} else {
				this.log(`Already building ${server} and it's already queued. Stop building me!! ${JSON.stringify(this.queuedJobs)}`)
			}
			return
		}
		
		const repoFolder = this.getRepoFolder(server)
		if (!fs.existsSync(repoFolder)) return
		this.currentCompileJobs.push(server)
		if (opts.fetchRepo) Repo.fetch(repoFolder)
		Repo.update(repoFolder)

		const compileLog = `/app/logs/builds/${server}-${Math.random().toString(36).substr(2, 9)}.log`		
		let cmd = `/bin/bash scripts/gate.sh -s ${server} -b ${compileLog} -c ${config.apiKey}`
		if (opts.skipCdn) cmd += ' -r'
		exec(cmd, (err, stdout, stderr) => {
			let lastCompileLogs = ''
			try {
				lastCompileLogs = fs.readFileSync(compileLog).toString()
				fs.unlinkSync(compileLog)
			} catch (e) {}
			const commit = Repo.getCurrentLocalHash(repoFolder)
			const payload = {
				server: server,
				last_compile: lastCompileLogs.trim(),
				branch: Repo.getBranch(repoFolder).trim(),
				author: Repo.getAuthor(repoFolder, commit).trim(),
				message: Repo.getMessage(repoFolder, commit).trim(),
				commit: commit.trim(),
				error: null,
				mapSwitch: opts.mapSwitch
			}
			
			if (err || stderr) {
				this.log(`Building ${server} failed. Error: ${err}. Stderr: ${stderr}`)
				payload.error = stderr || true
			} else {
				this.log(`Building ${server} succeeded! Output:\n${stdout}`)
			}
			if (!opts.skipNotifier) MedAss.sendBuildComplete(payload)
			this.currentCompileJobs = this.currentCompileJobs.filter(e => e !== server)

			// Trigger any queued items now
			if (this.queuedJobs.length) {
				for (const queuedJob of this.queuedJobs) {
					const qServer = queuedJob.server
					// Already building this server
					if (this.currentCompileJobs.includes(qServer)) continue
					// Remove the queued job, and trigger it
					this.log(`Triggering queued job for ${server}. ${JSON.stringify(this.queuedJobs)}`)
					this.queuedJobs = this.queuedJobs.filter(e => e.server !== qServer)
					this.build(qServer, queuedJob.opts)
					break
				}
			}
		})
	}

	run() {
		// this.log('Starting run')
		if (this.currentCompileJobs.length >= this.maxCompileJobs) {
			this.log('Already running max compile jobs, aborting.')
			return
		}
		
		const config = this.getConfig()
		const servers = Object.entries(config.servers)
		shuffleArray(servers)
		
		for (const [id, server] of servers) {
			if (!server.active) continue
			const repoFolder = this.getRepoFolder(id)
			if (!fs.existsSync(repoFolder)) continue
			Repo.fetch(repoFolder)
			const currentHash = Repo.getCurrentLocalHash(repoFolder)
			const latestHash = Repo.getLatestOriginHash(repoFolder)
			if (currentHash !== latestHash) {
				// Repo has updates, needs a build
				this.build(id)
			}
			if (this.currentCompileJobs.length >= this.maxCompileJobs) {
				this.log('Reached max compile jobs.')
				break
			}
		}

		// this.log('Finished run')
	}
}
