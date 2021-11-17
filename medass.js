import http from 'http'
import config from './config.js'

class MedAss {
	constructor() {
		this.url = config.medAss.url
		this.port = config.medAss.port
		this.key = config.medAss.key
	}

	sendBuildComplete(payload) {
		payload.api_key = this.key
		const data = JSON.stringify(payload)
		const options = {
		  hostname: this.url,
		  port: this.port,
		  path: '/wireci/build_finished',
		  method: 'POST',
		  headers: {
		    'Content-Type': 'application/json',
		    'Content-Length': data.length
		  }
		}

		const req = http.request(options)	
		req.on('error', error => {
		  console.error(error)
		})
		req.write(data)
		req.end()
	}
}

export default new MedAss()
