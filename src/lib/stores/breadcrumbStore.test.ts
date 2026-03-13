import { beforeEach, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { breadcrumbStore } from './breadcrumbStore';

describe('breadcrumbStore', () => {
	beforeEach(() => {
		if (typeof sessionStorage !== 'undefined') {
			sessionStorage.removeItem('tidal-ui-breadcrumbs');
		}
		breadcrumbStore.clearBreadcrumbs();
	});

	it('builds breadcrumbs from current location hierarchy, not visit history', () => {
		breadcrumbStore.visit('/history');
		expect(get(breadcrumbStore).breadcrumbs.map((crumb) => crumb.href)).toEqual(['/', '/history']);

		breadcrumbStore.visit('/library-suggestions');
		expect(get(breadcrumbStore).breadcrumbs.map((crumb) => crumb.href)).toEqual([
			'/',
			'/library-suggestions'
		]);

		breadcrumbStore.visit('/artist/42');
		expect(get(breadcrumbStore).breadcrumbs.map((crumb) => crumb.href)).toEqual(['/', '/artist/42']);
	});

	it('uses explicit parent relationships for detail hierarchy', () => {
		breadcrumbStore.setLabel('/artist/42', 'Artist Name');
		breadcrumbStore.setParent('/album/7', '/artist/42');
		breadcrumbStore.visit('/album/7');
		breadcrumbStore.setCurrentLabel('Album Name', '/album/7');

		const trail = get(breadcrumbStore).breadcrumbs;
		expect(trail.map((crumb) => crumb.href)).toEqual(['/', '/artist/42', '/album/7']);
		expect(trail.find((crumb) => crumb.href === '/artist/42')?.label).toBe('Artist Name');
		expect(trail.find((crumb) => crumb.href === '/album/7')?.label).toBe('Album Name');
	});

	it('goBack peels one structural level at a time', () => {
		breadcrumbStore.setLabel('/artist/42', 'Artist Name');
		breadcrumbStore.setLabel('/album/7', 'Album Name');
		breadcrumbStore.setLabel('/track/99', 'Track Name');
		breadcrumbStore.setParent('/album/7', '/artist/42');
		breadcrumbStore.setParent('/track/99', '/album/7');
		breadcrumbStore.visit('/track/99');

		expect(get(breadcrumbStore).breadcrumbs.map((crumb) => crumb.href)).toEqual([
			'/',
			'/artist/42',
			'/album/7',
			'/track/99'
		]);

		const firstBackTarget = breadcrumbStore.goBack('/track/99', '/');
		expect(firstBackTarget).toBe('/album/7');
		expect(get(breadcrumbStore).breadcrumbs.map((crumb) => crumb.href)).toEqual([
			'/',
			'/artist/42',
			'/album/7'
		]);

		const secondBackTarget = breadcrumbStore.goBack('/album/7', '/');
		expect(secondBackTarget).toBe('/artist/42');
		expect(get(breadcrumbStore).breadcrumbs.map((crumb) => crumb.href)).toEqual([
			'/',
			'/artist/42'
		]);
	});

	it('normalizes trailing slashes and preserves labels', () => {
		breadcrumbStore.visit('/artist/42/');
		breadcrumbStore.setCurrentLabel('Bill Evans', '/artist/42/');

		const trail = get(breadcrumbStore).breadcrumbs;
		expect(trail.map((crumb) => crumb.href)).toEqual(['/', '/artist/42']);
		expect(trail[trail.length - 1]?.label).toBe('Bill Evans');
	});

	it('falls back to root when hierarchy parent is unavailable', () => {
		breadcrumbStore.visit('/album/7/');
		expect(get(breadcrumbStore).breadcrumbs.map((crumb) => crumb.href)).toEqual(['/', '/album/7']);

		const target = breadcrumbStore.goBack('/track/999', '/');
		expect(target).toBe('/');
		expect(get(breadcrumbStore).breadcrumbs.map((crumb) => crumb.href)).toEqual(['/']);
	});
});
