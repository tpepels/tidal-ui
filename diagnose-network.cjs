#!/usr/bin/env node

const https = require('https');
const dns = require('dns').promises;
const { performance } = require('perf_hooks');

// Comprehensive network diagnostics for Tidal API proxies
const targets = [
	'https://triton.squid.wtf',
	'https://tidal.kinoplus.online',
	'https://tidal-api.binimum.org',
	'https://hund.qqdl.site',
	'https://katze.qqdl.site',
	'https://maus.qqdl.site',
	'https://vogel.qqdl.site',
	'https://wolf.qqdl.site'
];

class NetworkDiagnostics {
	constructor() {
		this.results = [];
		this.globalStats = {
			totalRequests: 0,
			successfulRequests: 0,
			failedRequests: 0,
			averageResponseTime: 0,
			totalResponseTime: 0,
			dnsFailures: 0,
			connectionFailures: 0,
			timeoutFailures: 0
		};
	}

	async runDiagnostics() {
		console.log('🔬 Comprehensive Network Diagnostics for Tidal API Proxies\n');
		console.log('Testing DNS resolution, connectivity, SSL, and HTTP response analysis...\n');

		for (const target of targets) {
			await this.diagnoseTarget(target);
		}

		this.printSummary();
		this.printRecommendations();
	}

	async diagnoseTarget(url) {
		const hostname = new URL(url).hostname;
		console.log(`🔍 Diagnosing ${hostname}...`);

		const result = {
			hostname,
			url,
			dns: null,
			connectivity: null,
			ssl: null,
			http: null,
			overall: 'UNKNOWN'
		};

		// 1. DNS Resolution
		console.log('  📡 DNS Resolution...');
		result.dns = await this.testDNS(hostname);

		if (!result.dns.success) {
			result.overall = 'DNS_FAILURE';
			this.results.push(result);
			this.globalStats.dnsFailures++;
			return;
		}

		// 2. Basic Connectivity & SSL
		console.log('  🌐 Connectivity & SSL...');
		result.connectivity = await this.testConnectivity(url);
		result.ssl = await this.testSSL(url);

		if (!result.connectivity.success) {
			result.overall = 'CONNECTIVITY_FAILURE';
			this.results.push(result);
			this.globalStats.connectionFailures++;
			return;
		}

		// 3. HTTP Response Analysis
		console.log('  📋 HTTP Response Analysis...');
		result.http = await this.testHTTPResponses(url);

		// Determine overall status
		if (result.http.apiEndpoints.every((e) => e.status === 404)) {
			result.overall = 'API_DOWN';
		} else if (result.http.apiEndpoints.some((e) => e.success)) {
			result.overall = 'PARTIAL_SUCCESS';
		} else {
			result.overall = 'FULL_FAILURE';
		}

		this.results.push(result);
		this.updateGlobalStats(result);
	}

	async testDNS(hostname) {
		try {
			const startTime = performance.now();
			const addresses = await dns.lookup(hostname);
			const responseTime = performance.now() - startTime;

			return {
				success: true,
				addresses: addresses.address,
				responseTime: Math.round(responseTime),
				type: addresses.family === 4 ? 'IPv4' : 'IPv6'
			};
		} catch (error) {
			return {
				success: false,
				error: error.code || 'UNKNOWN',
				responseTime: 0
			};
		}
	}

	async testConnectivity(url) {
		return new Promise((resolve) => {
			const startTime = performance.now();
			const req = https.request(url, { method: 'HEAD', timeout: 10000 }, (res) => {
				const responseTime = performance.now() - startTime;
				resolve({
					success: true,
					statusCode: res.statusCode,
					responseTime: Math.round(responseTime),
					headers: res.headers
				});
			});

			req.on('error', (error) => {
				resolve({
					success: false,
					error: error.code,
					responseTime: Math.round(performance.now() - startTime)
				});
			});

			req.on('timeout', () => {
				req.destroy();
				resolve({
					success: false,
					error: 'TIMEOUT',
					responseTime: Math.round(performance.now() - startTime)
				});
			});

			req.end();
		});
	}

	async testSSL(url) {
		return new Promise((resolve) => {
			const startTime = performance.now();
			const req = https.request(url, { method: 'HEAD', timeout: 5000 }, (res) => {
				const responseTime = performance.now() - startTime;
				const cert = res.socket?.getPeerCertificate?.();

				resolve({
					success: true,
					valid: true, // Assume valid if connection succeeded
					issuer: cert?.issuer?.CN || 'Unknown',
					validUntil: cert?.valid_to || 'Unknown',
					responseTime: Math.round(responseTime)
				});
			});

			req.on('error', (error) => {
				resolve({
					success: false,
					error: error.code,
					responseTime: Math.round(performance.now() - startTime)
				});
			});

			req.on('timeout', () => {
				req.destroy();
				resolve({
					success: false,
					error: 'TIMEOUT',
					responseTime: Math.round(performance.now() - startTime)
				});
			});

			req.end();
		});
	}

	async testHTTPResponses(baseUrl) {
		const endpoints = [
			{ path: '/', description: 'Root endpoint' },
			{ path: '/search/?s=test&limit=1', description: 'Search endpoint' },
			{ path: '/track/?id=123&quality=LOSSLESS', description: 'Track endpoint' },
			{ path: '/album/?id=123', description: 'Album endpoint' }
		];

		const results = [];

		for (const endpoint of endpoints) {
			const result = await this.testConnectivity(baseUrl + endpoint.path);
			results.push({
				...endpoint,
				...result
			});
		}

		return {
			apiEndpoints: results,
			successCount: results.filter((r) => r.success).length,
			failureCount: results.filter((r) => !r.success).length
		};
	}

	updateGlobalStats(result) {
		if (result.connectivity) {
			this.globalStats.totalRequests++;
			if (result.connectivity.success) {
				this.globalStats.successfulRequests++;
				this.globalStats.totalResponseTime += result.connectivity.responseTime;
			} else {
				this.globalStats.failedRequests++;
			}
		}

		if (result.dns && !result.dns.success) {
			this.globalStats.dnsFailures++;
		}
	}

	printSummary() {
		console.log('\n📊 Network Diagnostics Summary:');
		console.log('='.repeat(50));

		const statusCounts = {};
		this.results.forEach((r) => {
			statusCounts[r.overall] = (statusCounts[r.overall] || 0) + 1;
		});

		Object.entries(statusCounts).forEach(([status, count]) => {
			console.log(`${status}: ${count} endpoints`);
		});

		console.log(`\nGlobal Stats:`);
		console.log(`Total Requests: ${this.globalStats.totalRequests}`);
		console.log(`Successful: ${this.globalStats.successfulRequests}`);
		console.log(`Failed: ${this.globalStats.failedRequests}`);
		if (this.globalStats.successfulRequests > 0) {
			console.log(
				`Average Response Time: ${Math.round(this.globalStats.totalResponseTime / this.globalStats.successfulRequests)}ms`
			);
		}
		console.log(`DNS Failures: ${this.globalStats.dnsFailures}`);

		console.log('\n📋 Detailed Results:');
		this.results.forEach((result) => {
			const status = this.getStatusIcon(result.overall);
			console.log(`${status} ${result.hostname}: ${result.overall}`);

			if (result.dns && !result.dns.success) {
				console.log(`   └─ DNS: ❌ ${result.dns.error}`);
			} else if (result.connectivity && !result.connectivity.success) {
				console.log(
					`   └─ Connectivity: ❌ ${result.connectivity.error} (${result.connectivity.responseTime}ms)`
				);
			} else if (result.http) {
				const apiSuccess = result.http.apiEndpoints.filter((e) => e.success).length;
				const apiTotal = result.http.apiEndpoints.length;
				console.log(`   └─ API Endpoints: ${apiSuccess}/${apiTotal} working`);
			}
		});
	}

	printRecommendations() {
		console.log('\n💡 Recommendations:');

		const workingAPIs = this.results.filter(
			(r) => r.overall === 'PARTIAL_SUCCESS' || r.http?.successCount > 0
		);

		if (workingAPIs.length > 0) {
			console.log('✅ Working APIs found:');
			workingAPIs.forEach((api) => {
				console.log(`   - ${api.hostname}`);
			});
			console.log('   Update your config to prioritize these.');
		} else {
			console.log('❌ No working APIs found.');
			console.log('   - Check if your network/firewall blocks these domains');
			console.log('   - Try from a different network/VPN');
			console.log('   - Look for updated proxy lists in Tidal communities');
			console.log('   - Consider implementing official Tidal API integration');
		}

		if (this.globalStats.dnsFailures > 0) {
			console.log('⚠️  DNS issues detected - may be network or ISP related');
		}

		console.log('\n🔄 Next Steps:');
		console.log('1. Update src/lib/config.ts with working proxy URLs');
		console.log('2. Run tests: npm run test:run');
		console.log('3. Test app functionality manually');
		console.log('4. Monitor API stability over time');
	}

	getStatusIcon(status) {
		switch (status) {
			case 'PARTIAL_SUCCESS':
				return '🟡';
			case 'API_DOWN':
				return '🔴';
			case 'DNS_FAILURE':
				return '❌';
			case 'CONNECTIVITY_FAILURE':
				return '❌';
			case 'FULL_FAILURE':
				return '🔴';
			default:
				return '❓';
		}
	}
}

// Run diagnostics
const diagnostics = new NetworkDiagnostics();
diagnostics.runDiagnostics().catch(console.error);
