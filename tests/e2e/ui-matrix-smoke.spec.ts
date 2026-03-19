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

	test('mobile primary navigation stays available when the sidebar is hidden', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/settings');

		const mobileNav = page.locator('.mobile-primary-nav');
		await expect(mobileNav).toBeVisible();
		await expect(mobileNav.getByRole('link', { name: 'Browse & Search' })).toBeVisible();
		await expect(mobileNav.getByRole('link', { name: 'Download Center' })).toBeVisible();

		await mobileNav.getByRole('link', { name: 'History' }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible();
	});

	test('mobile layouts avoid horizontal page overflow on primary collection and tool routes', async ({
		page
	}) => {
		for (const width of [320, 390, 430]) {
			await page.setViewportSize({ width, height: 844 });
			for (const route of ['/', '/library-suggestions', '/ui-archetypes']) {
				await page.goto(route);
				const overflow = await page.evaluate(() =>
					Math.max(0, document.documentElement.scrollWidth - window.innerWidth)
				);
				expect(overflow).toBeLessThanOrEqual(1);
			}
		}
	});

	test('mobile search and section navigation prefer page scroll over sticky route chrome', async ({
		page
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/');

		const searchControls = page.locator('.search-controls');
		await expect(searchControls).toBeVisible();
		expect(await searchControls.evaluate((node) => getComputedStyle(node).position)).toBe('static');

		const scopeGroup = page.locator('.search-panel__scope');
		await expect(scopeGroup).toBeVisible();
		const scopeMetrics = await scopeGroup.evaluate((node) => ({
			flexWrap: getComputedStyle(node).flexWrap,
			overflowX: getComputedStyle(node).overflowX,
			scrollWidth: node.scrollWidth,
			clientWidth: node.clientWidth
		}));
		expect(scopeMetrics.flexWrap).toBe('wrap');
		expect(scopeMetrics.overflowX).not.toBe('auto');
		expect(scopeMetrics.scrollWidth).toBeLessThanOrEqual(scopeMetrics.clientWidth + 1);

		await page.goto('/settings');
		const sectionNav = page.locator('.ui-section-nav');
		await expect(sectionNav).toBeVisible();
		expect(await sectionNav.evaluate((node) => getComputedStyle(node).position)).toBe('static');
	});

	test('mobile keeps bounded tool surfaces scrollable while page-mode download center stays in page flow', async ({
		page
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });

		await page.goto('/download-center');
		const pageModeContent = page.locator('.download-manager-panel--page .download-manager-content');
		await expect(pageModeContent).toBeVisible();
		expect(await pageModeContent.evaluate((node) => getComputedStyle(node).overflowY)).toBe(
			'visible'
		);

		await page.goto('/download-log');
		const logContent = page.locator('.download-log-content');
		const logMetrics = await logContent.evaluate((node) => ({
			overflowY: getComputedStyle(node).overflowY
		}));
		expect(logMetrics.overflowY).toBe('auto');
	});
});
