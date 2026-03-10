import { describe, expect, it } from 'vitest';
import { appRoutes, getRouteMeta } from './routeMeta';

describe('routeMeta', () => {
	it('registers all critical sidebar routes', () => {
		const criticalPaths = ['/', '/history', '/settings', '/download-center', '/download-log', '/status'];
		for (const path of criticalPaths) {
			expect(getRouteMeta(path)).toBeTruthy();
		}
	});

	it('returns metadata for nested route paths', () => {
		expect(getRouteMeta('/download-center/details')?.path).toBe('/download-center');
		expect(getRouteMeta('/status/runtime')?.path).toBe('/status');
		expect(getRouteMeta('/settings/audio')?.path).toBe('/settings');
	});

	it('keeps route definitions unique by path', () => {
		const paths = appRoutes.map((route) => route.path);
		expect(new Set(paths).size).toBe(paths.length);
	});
});
