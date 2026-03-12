import { expect, test } from '@playwright/test';

const desktopRoutes: Array<{ path: string; heading: string }> = [
	{ path: '/settings', heading: 'Settings' },
	{ path: '/status', heading: 'Status' },
	{ path: '/download-center', heading: 'Download Center' },
	{ path: '/download-log', heading: 'Download Log' },
	{ path: '/history', heading: 'History' },
	{ path: '/library-suggestions', heading: 'Library Suggestions' },
	{ path: '/ui-archetypes', heading: 'UI Archetype Visual Baselines' }
];

test.describe('UI matrix smoke', () => {
	test('desktop headings render on core routes', async ({ page }) => {
		for (const route of desktopRoutes) {
			await page.goto(route.path);
			await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
		}
	});

	test('mobile + reduced-motion keeps controls visible and touch-friendly', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.emulateMedia({ reducedMotion: 'reduce' });

		for (const route of ['/settings', '/status', '/download-center', '/download-log']) {
			await page.goto(route);
			const firstInteractive = page
				.locator('.ui-page button, .ui-page .ui-action-button, .ui-page .ui-chip-button')
				.first();
			await expect(firstInteractive).toBeVisible();
			const box = await firstInteractive.boundingBox();
			expect(box?.height ?? 0).toBeGreaterThanOrEqual(40);
		}
	});
});
