import { expect, test } from '@playwright/test';

test.describe('UI archetype visual baselines', () => {
	test('matches visual snapshots for archetype cards', async ({ page }) => {
		await page.setViewportSize({ width: 1600, height: 1200 });
		await page.goto('/ui-archetypes');

		// Use low-performance mode to reduce visual noise in snapshots.
		await page.evaluate(() => {
			document.documentElement.setAttribute('data-performance', 'low');
		});

		const screenshotOptions = {
			animations: 'disabled' as const,
			caret: 'hide' as const
		};

		await expect(page.getByTestId('archetype-tool')).toHaveScreenshot(
			'archetype-tool.png',
			screenshotOptions
		);
		await expect(page.getByTestId('archetype-detail')).toHaveScreenshot(
			'archetype-detail.png',
			screenshotOptions
		);
		await expect(page.getByTestId('archetype-collection')).toHaveScreenshot(
			'archetype-collection.png',
			screenshotOptions
		);
		await expect(page.getByTestId('archetype-embed')).toHaveScreenshot(
			'archetype-embed.png',
			screenshotOptions
		);
	});
});
