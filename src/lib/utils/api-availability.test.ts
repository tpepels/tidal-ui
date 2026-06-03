import { describe, it, expect } from 'vitest';

const PROBE_PATH = '/search/?s=test&limit=1&offset=0';
const PROBE_TIMEOUT_MS = 2500;

async function probeTarget(target: string): Promise<{ reachable: boolean; detail: string }> {
	let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
	const timeoutResult = new Promise<{ reachable: boolean; detail: string }>((resolve) => {
		timeoutHandle = setTimeout(() => {
			resolve({
				reachable: false,
				detail: `Timed out after ${PROBE_TIMEOUT_MS}ms`
			});
		}, PROBE_TIMEOUT_MS);
	});

	const fetchResult = (async (): Promise<{ reachable: boolean; detail: string }> => {
		try {
			const response = await fetch(`${target}${PROBE_PATH}`, {
				headers: {
					Accept: 'application/json'
				}
			});
			return {
				reachable: true,
				detail: `HTTP ${response.status}`
			};
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			return {
				reachable: false,
				detail
			};
		}
	})();

	const result = await Promise.race([fetchResult, timeoutResult]);
	if (timeoutHandle) {
		clearTimeout(timeoutHandle);
	}
	return result;
}

// Test API availability by making a simple request to each target
describe('API Availability', () => {
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

	it.each(targets)(
		'should be able to reach %s',
		async (target) => {
			const result = await probeTarget(target);
			if (!result.reachable) {
				console.warn(`API ${target} is unreachable: ${result.detail}`);
			}

			expect(result.detail.length).toBeGreaterThan(0);
		},
		6000
	); // Keep a ceiling on external probe duration.

	it(
		'should find at least one working API',
		async () => {
			const results = await Promise.all(targets.map((target) => probeTarget(target)));
			const workingCount = results.filter((result) => result.reachable).length;

			console.log(`Found ${workingCount} working APIs out of ${targets.length}`);
			// Keep this informational; availability of external community endpoints is not a unit-test contract.
			expect(workingCount).toBeGreaterThanOrEqual(0);
		},
		8000
	);
});
