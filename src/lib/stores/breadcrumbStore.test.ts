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

	it('keeps breadcrumbs path-relative when revisiting earlier pages', () => {
		breadcrumbStore.visit('/artist/42');
		breadcrumbStore.visit('/album/7');
		breadcrumbStore.visit('/track/99');
		breadcrumbStore.visit('/album/7');

		const initialTrail = get(breadcrumbStore).breadcrumbs.map((crumb) => crumb.href);
		expect(initialTrail).toEqual(['/', '/artist/42', '/album/7']);

		const firstBackTarget = breadcrumbStore.goBack('/album/7', '/');
		expect(firstBackTarget).toBe('/artist/42');
		expect(get(breadcrumbStore).breadcrumbs.map((crumb) => crumb.href)).toEqual(['/', '/artist/42']);

		const secondBackTarget = breadcrumbStore.goBack('/track/99', '/');
		expect(secondBackTarget).toBe('/');
		expect(get(breadcrumbStore).breadcrumbs.map((crumb) => crumb.href)).toEqual(['/']);
	});

	it('updates labels for the current page and matching existing crumbs', () => {
		breadcrumbStore.visit('/artist/42');
		breadcrumbStore.visit('/album/7');
		breadcrumbStore.setCurrentLabel('Album Name', '/album/7');
		breadcrumbStore.setLabel('/artist/42', 'Artist Name');

		const trail = get(breadcrumbStore).breadcrumbs;
		expect(trail.find((crumb) => crumb.href === '/artist/42')?.label).toBe('Artist Name');
		expect(trail.find((crumb) => crumb.href === '/album/7')?.label).toBe('Album Name');
	});

	it('normalizes trailing slashes and keeps back navigation within the trail', () => {
		breadcrumbStore.visit('/artist/42/');
		breadcrumbStore.visit('/album/7/');

		expect(get(breadcrumbStore).breadcrumbs.map((crumb) => crumb.href)).toEqual([
			'/',
			'/artist/42',
			'/album/7'
		]);

		const target = breadcrumbStore.goBack('/album/7/', '/');
		expect(target).toBe('/artist/42');
		expect(get(breadcrumbStore).breadcrumbs.map((crumb) => crumb.href)).toEqual([
			'/',
			'/artist/42'
		]);
	});

	it('falls back to previous trail entry when current path is missing', () => {
		breadcrumbStore.visit('/artist/42');
		breadcrumbStore.visit('/album/7');

		const target = breadcrumbStore.goBack('/track/999', '/');
		expect(target).toBe('/artist/42');
		expect(get(breadcrumbStore).breadcrumbs.map((crumb) => crumb.href)).toEqual([
			'/',
			'/artist/42'
		]);
	});
});
