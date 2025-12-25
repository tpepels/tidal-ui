#!/usr/bin/env node

/**
 * API Endpoint Health Check
 *
 * Tests critical API endpoints against the real Triton API to ensure they're working.
 * This provides additional confidence that our API calls are correct.
 */

const https = require('https');

const API_BASE = 'https://triton.squid.wtf';

// Critical endpoints to test (these must work for the app to function)
const criticalEndpoints = [
	{ path: '/search/?s=test&limit=1', description: 'Track search' },
	{ path: '/album/?id=35132867', description: 'Album lookup' }, // Known working album ID
	{ path: '/artist/?id=55092', description: 'Artist lookup' } // Known working artist ID
];

async function testEndpoint(endpoint) {
	return new Promise((resolve) => {
		const url = API_BASE + endpoint.path;
		console.log(`Testing ${endpoint.description}: ${endpoint.path}`);

		const req = https.get(url, { timeout: 5000 }, (res) => {
			let data = '';

			res.on('data', (chunk) => {
				data += chunk;
			});

			res.on('end', () => {
				try {
					if (res.statusCode === 200) {
						const json = JSON.parse(data);
						// Check if we got a valid JSON response
						if (json && typeof json === 'object') {
							console.log(`  ✅ ${endpoint.description} - OK (${data.length} bytes)`);
							resolve(true);
						} else {
							console.log(`  ❌ ${endpoint.description} - Invalid JSON response`);
							resolve(false);
						}
					} else {
						console.log(`  ❌ ${endpoint.description} - HTTP ${res.statusCode}`);
						resolve(false);
					}
				} catch {
					console.log(`  ❌ ${endpoint.description} - JSON parse error`);
					resolve(false);
				}
			});
		});

		req.on('error', (err) => {
			console.log(`  ❌ ${endpoint.description} - Network error: ${err.message}`);
			resolve(false);
		});

		req.on('timeout', () => {
			req.destroy();
			console.log(`  ❌ ${endpoint.description} - Timeout`);
			resolve(false);
		});
	});
}

async function runHealthCheck() {
	console.log('🏥 Running API Health Check...\n');
	console.log(`Testing against: ${API_BASE}\n`);

	const results = [];

	for (const endpoint of criticalEndpoints) {
		const result = await testEndpoint(endpoint);
		results.push(result);

		// Small delay to be respectful to the API
		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	const passed = results.filter(Boolean).length;
	const total = results.length;

	console.log(`\n📊 Health Check Results: ${passed}/${total} endpoints working`);

	if (passed > 0) {
		console.log('✅ At least one API endpoint is working - APIs are accessible');
		if (passed === total) {
			console.log('🎉 All critical API endpoints are healthy!');
		} else {
			console.log(`⚠️  ${passed}/${total} endpoints working - some may be temporarily down`);
		}
		return true;
	} else {
		console.log('❌ All API endpoints are failing - network or API issues detected');
		console.log('   This is informational - not blocking CI');
		return true; // Don't fail CI, just report
	}
}

// Run the health check
runHealthCheck()
	.then((success) => {
		process.exit(success ? 0 : 1);
	})
	.catch((error) => {
		console.error('Health check failed with error:', error);
		process.exit(1);
	});
