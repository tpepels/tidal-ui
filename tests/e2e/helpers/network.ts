import type { Page, Route } from '@playwright/test';

type ProxyMatcher = (route: Route) => boolean;

const defaultMatcher: ProxyMatcher = (route) => route.request().url().includes('/api/proxy');

export const applySlowProxy = async (
	page: Page,
	delayMs: number,
	matcher: ProxyMatcher = defaultMatcher
): Promise<void> => {
	await page.route('**/*', async (route) => {
		if (!matcher(route)) {
			await route.continue();
			return;
		}
		await new Promise((resolve) => setTimeout(resolve, delayMs));
		await route.continue();
	});
};

export const applyFlakyProxy = async (
	page: Page,
	failures: number,
	matcher: ProxyMatcher = defaultMatcher
): Promise<void> => {
	let remaining = failures;
	await page.route('**/*', async (route) => {
		if (!matcher(route)) {
			await route.continue();
			return;
		}
		if (remaining > 0) {
			remaining -= 1;
			await route.fulfill({
				status: 503,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'Injected flake for testing' })
			});
			return;
		}
		await route.continue();
	});
};
