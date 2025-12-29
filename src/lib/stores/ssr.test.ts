// @vitest-environment node
import { describe, expect, it } from 'vitest';

describe('stores SSR', () => {
	it('imports store modules without browser globals', async () => {
		const modules = await Promise.all([
			import('$lib/stores/player'),
			import('$lib/stores/downloadUi'),
			import('$lib/stores/downloadLog'),
			import('$lib/stores/downloadPreferences'),
			import('$lib/stores/region'),
			import('$lib/stores/network'),
			import('$lib/stores/performance'),
			import('$lib/stores/lyrics'),
			import('$lib/stores/searchStoreAdapter'),
			import('$lib/stores/userPreferences')
		]);

		expect(modules.length).toBeGreaterThan(0);
	});
});
