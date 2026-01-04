import { describe, expect, it, vi } from 'vitest';

describe('APP_VERSION', () => {
	it('uses a version string prefix', () => {
		vi.unmock('$lib/version');
		return vi.importActual<typeof import('./version')>('./version').then(({ APP_VERSION }) => {
			expect(APP_VERSION).toMatch(/^v\d/);
		});
	});
});
