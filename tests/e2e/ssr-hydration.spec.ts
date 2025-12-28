import { test, expect } from '@playwright/test';

test('homepage hydrates without console errors', async ({ page }) => {
	const consoleErrors: string[] = [];
	const pageErrors: string[] = [];
	const ignoredConsolePatterns = [/ssl certificate/i, /serviceworker/i];
	const ignoredPageErrorPatterns = [/ssl certificate/i, /serviceworker/i];

	page.on('console', (message) => {
		if (message.type() === 'error') {
			const text = message.text();
			if (!ignoredConsolePatterns.some((pattern) => pattern.test(text))) {
				consoleErrors.push(text);
			}
		}
	});

	page.on('pageerror', (error) => {
		const message = error.message;
		if (!ignoredPageErrorPatterns.some((pattern) => pattern.test(message))) {
			pageErrors.push(message);
		}
	});

	await page.goto('/');
	await page.waitForTimeout(1000);

	await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();

	expect(consoleErrors).toEqual([]);
	expect(pageErrors).toEqual([]);
});
