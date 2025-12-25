#!/usr/bin/env node

const https = require('https');

// List of potential Tidal proxy APIs to test
const potentialAPIs = [
	'https://triton.squid.wtf',
	'https://tidal.kinoplus.online',
	'https://tidal-api.binimum.org',
	'https://hund.qqdl.site',
	'https://katze.qqdl.site',
	'https://maus.qqdl.site',
	'https://vogel.qqdl.site',
	'https://wolf.qqdl.site',
	// Add some alternative APIs that might work
	'https://api.tidal.com', // Official - but requires auth
	'https://listen.tidal.com',
	// Some other known proxies (these might not work)
	'https://tidal-api.vercel.app',
	'https://tidal-api.glitch.me'
];

async function testAPI(url) {
	return new Promise((resolve) => {
		const testUrl = `${url}/search/tracks?query=test&limit=1`;

		https
			.get(testUrl, { timeout: 5000 }, (res) => {
				resolve({
					url,
					status: res.statusCode,
					working: res.statusCode !== 404 && res.statusCode !== 502 && res.statusCode !== 503
				});
			})
			.on('error', () => {
				resolve({
					url,
					status: 'ERROR',
					working: false
				});
			})
			.on('timeout', () => {
				resolve({
					url,
					status: 'TIMEOUT',
					working: false
				});
			});
	});
}

async function main() {
	console.log('Testing Tidal proxy APIs...\n');

	const results = await Promise.all(potentialAPIs.map(testAPI));

	console.log('Results:');
	results.forEach((result) => {
		const status = result.working ? '✅ WORKING' : `❌ ${result.status}`;
		console.log(`${status}: ${result.url}`);
	});

	const workingAPIs = results.filter((r) => r.working).map((r) => r.url);
	console.log(`\nFound ${workingAPIs.length} working APIs`);

	if (workingAPIs.length > 0) {
		console.log('\nWorking APIs:');
		workingAPIs.forEach((url) => console.log(`  ${url}`));
	} else {
		console.log(
			'\n❌ No working APIs found. You may need to find alternative Tidal proxy services.'
		);
		console.log('Consider checking for updated proxy lists in Tidal community forums.');
	}
}

main().catch(console.error);
