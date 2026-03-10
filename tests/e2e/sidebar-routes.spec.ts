import { expect, test } from '@playwright/test';

const routeHeadings: Array<{ path: string; heading: string }> = [
	{ path: '/settings', heading: 'Settings' },
	{ path: '/status', heading: 'Status' },
	{ path: '/download-center', heading: 'Download Center' },
	{ path: '/download-log', heading: 'Download Log' },
	{ path: '/history', heading: 'History' }
];

test.describe('Sidebar routes', () => {
	for (const route of routeHeadings) {
		test(`loads ${route.path}`, async ({ page }) => {
			await page.goto(route.path);
			await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible();
		});
	}

	test('status polling does not spawn duplicate requests after navigation', async ({ page }) => {
		const healthRequests: number[] = [];
		await page.route('**/api/health', async (route) => {
			healthRequests.push(Date.now());
			await route.continue();
		});

		await page.goto('/status');
		await page.waitForTimeout(6000);
		await page.goto('/settings');
		await page.waitForTimeout(2000);
		await page.goto('/status');
		await page.waitForTimeout(6000);

		// Loose guard: status should poll roughly every 5s, but not explode into rapid loops.
		expect(healthRequests.length).toBeLessThan(8);
	});
});
