import { test, expect } from '@playwright/test';

test('playback flow toggles play state', async ({ page }) => {
	await page.addInitScript(() => {
		const originalPlay = HTMLMediaElement.prototype.play;
		const originalPause = HTMLMediaElement.prototype.pause;
		HTMLMediaElement.prototype.play = function (...args) {
			try {
				this.dispatchEvent(new Event('playing'));
			} catch {
				// ignore
			}
			return Promise.resolve();
		};
		HTMLMediaElement.prototype.pause = function () {
			try {
				this.dispatchEvent(new Event('pause'));
			} catch {
				// ignore
			}
			return originalPause.apply(this);
		};
		void originalPlay;
	});
	page.on('console', (msg) => {
		console.log(`[browser:${msg.type()}] ${msg.text()}`);
	});
	page.on('pageerror', (error) => {
		console.log(`[pageerror] ${error}`);
	});
	page.on('requestfailed', (request) => {
		console.log(`[requestfailed] ${request.url()} ${request.failure()?.errorText ?? ''}`.trim());
	});
	page.on('response', (response) => {
		if (response.url().includes('/api/proxy')) {
			console.log(`[response] ${response.status()} ${response.url()}`);
		}
	});

	await page.goto('/', { waitUntil: 'domcontentloaded' });

	const searchInput = page.locator('input[placeholder*="Search"]');
	await searchInput.fill('test');
	const searchResponse = page.waitForResponse((response) => {
		return response.url().includes('/api/proxy') && response.status() === 200;
	});
	await searchInput.press('Enter');
	await searchResponse;

	const trackButton = page.getByRole('button', { name: /Mock Track/i }).first();
	await expect(trackButton).toBeVisible();
	await trackButton.scrollIntoViewIfNeeded();
	try {
		await trackButton.click({ force: true, timeout: 5000 });
	} catch (error) {
		console.log('[playback-flow] primary click failed, falling back to DOM click', error);
		await trackButton.evaluate((element) => {
			if (element instanceof HTMLElement) {
				element.click();
			}
		});
	}

	const playerTitle = page.getByRole('heading', { name: /Mock Track/i }).first();
	await expect(playerTitle).toBeVisible();

	const player = page.locator('.audio-player-glass');
	await expect(player).toBeVisible();
	const toggleButton = player.locator('button[aria-label="Play"], button[aria-label="Pause"]').first();
	await expect(toggleButton).toHaveAttribute('aria-label', /Play|Pause/);
	const initialLabel = await toggleButton.getAttribute('aria-label');

	await toggleButton.click();
	await expect(toggleButton).toHaveAttribute(
		'aria-label',
		initialLabel === 'Play' ? 'Pause' : 'Play'
	);
});
