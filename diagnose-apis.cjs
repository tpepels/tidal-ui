#!/usr/bin/env node

const https = require('https');
const dns = require('dns').promises;

// Comprehensive API diagnostic tool
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

async function resolveDNS(hostname) {
	try {
		const addresses = await dns.lookup(hostname);
		return { success: true, addresses: addresses.address };
	} catch (error) {
		return { success: false, error: error.code };
	}
}

async function testConnection(url) {
	return new Promise((resolve) => {
		const startTime = Date.now();
		const req = https.request(
			url,
			{
				method: 'HEAD',
				timeout: 10000,
				headers: {
					'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
				}
			},
			(res) => {
				const responseTime = Date.now() - startTime;
				resolve({
					status: res.statusCode,
					headers: res.headers,
					responseTime,
					success: res.statusCode < 400
				});
			}
		);

		req.on('error', (error) => {
			resolve({
				error: error.code,
				responseTime: Date.now() - startTime,
				success: false
			});
		});

		req.on('timeout', () => {
			req.destroy();
			resolve({
				error: 'TIMEOUT',
				responseTime: Date.now() - startTime,
				success: false
			});
		});

		req.end();
	});
}

async function testAPIEndpoint(baseUrl) {
	const testUrls = [
		`${baseUrl}/search/tracks?query=test&limit=1`,
		`${baseUrl}/track/123?quality=LOSSLESS`,
		`${baseUrl}/` // root endpoint
	];

	const results = [];
	for (const url of testUrls) {
		const result = await testConnection(url);
		results.push({ url, ...result });
	}
	return results;
}

async function diagnoseAPI(baseUrl) {
	const hostname = new URL(baseUrl).hostname;
	console.log(`\n🔍 Diagnosing ${hostname}...`);

	// 1. DNS Resolution
	console.log('  📡 DNS Resolution...');
	const dnsResult = await resolveDNS(hostname);
	if (dnsResult.success) {
		console.log(`    ✅ Resolves to: ${dnsResult.addresses}`);
	} else {
		console.log(`    ❌ DNS failed: ${dnsResult.error}`);
		return { hostname, dns: dnsResult, reachable: false };
	}

	// 2. Basic Connectivity
	console.log('  🌐 Basic Connectivity...');
	const rootResult = await testConnection(baseUrl + '/');
	if (rootResult.success) {
		console.log(`    ✅ Root endpoint: ${rootResult.status} (${rootResult.responseTime}ms)`);
	} else {
		console.log(
			`    ❌ Root endpoint failed: ${rootResult.error || rootResult.status} (${rootResult.responseTime}ms)`
		);
	}

	// 3. API Endpoints
	console.log('  🔗 API Endpoints...');
	const apiResults = await testAPIEndpoint(baseUrl);

	apiResults.forEach((result) => {
		const endpoint = result.url.replace(baseUrl, '');
		if (result.success) {
			console.log(`    ✅ ${endpoint}: ${result.status} (${result.responseTime}ms)`);
		} else {
			console.log(
				`    ❌ ${endpoint}: ${result.error || result.status} (${result.responseTime}ms)`
			);
		}
	});

	// 4. CORS Headers Check
	if (apiResults[0].success && apiResults[0].headers) {
		console.log('  🔒 CORS Headers...');
		const corsHeaders = ['access-control-allow-origin', 'access-control-allow-methods'];
		corsHeaders.forEach((header) => {
			if (apiResults[0].headers[header]) {
				console.log(`    ✅ ${header}: ${apiResults[0].headers[header]}`);
			} else {
				console.log(`    ⚠️  ${header}: missing`);
			}
		});
	}

	return {
		hostname,
		dns: dnsResult,
		root: rootResult,
		api: apiResults,
		reachable: rootResult.success || apiResults.some((r) => r.success)
	};
}

async function main() {
	console.log('🔬 Comprehensive Tidal API Diagnostics\n');
	console.log('Testing DNS resolution, connectivity, and API endpoints...\n');

	const results = [];
	for (const target of targets) {
		const result = await diagnoseAPI(target);
		results.push(result);
	}

	console.log('\n📊 Summary:');
	const reachable = results.filter((r) => r.reachable);
	const unreachable = results.filter((r) => !r.reachable);

	console.log(`✅ Reachable APIs: ${reachable.length}`);
	reachable.forEach((r) => console.log(`   - ${r.hostname}`));

	console.log(`❌ Unreachable APIs: ${unreachable.length}`);
	unreachable.forEach((r) => console.log(`   - ${r.hostname}`));

	console.log('\n🎯 Conclusions:');
	if (reachable.length === 0) {
		console.log('❌ ALL APIs are unreachable - this is a widespread outage');
		console.log('💡 Likely causes:');
		console.log('   - All proxy services are down');
		console.log('   - DNS issues affecting multiple hosts');
		console.log('   - Network connectivity problems');
		console.log('   - Services moved or shut down');
	} else {
		console.log('✅ Some APIs are reachable - check individual endpoint issues');
	}

	console.log('\n🔧 Next Steps:');
	console.log('1. Check if your network can reach these hosts');
	console.log('2. Try from different locations/networks');
	console.log('3. Look for updated proxy lists in Tidal communities');
	console.log('4. Consider implementing official Tidal API with authentication');
}

main().catch(console.error);
