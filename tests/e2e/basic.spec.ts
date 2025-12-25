import { test, expect } from '@playwright/test';

test('homepage loads', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveTitle(/Tidal UI/);
});

test('search interface is visible', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('input[placeholder*="search"]')).toBeVisible();
});

test('can perform search', async ({ page }) => {
	await page.goto('/');
	await page.fill('input[placeholder*="search"]', 'test track');
	await page.press('Enter');

	// Wait for results or error
	await page.waitForTimeout(2000);
	expect(page.url()).toContain('/?q=test+track');
});

test('navigation to album page', async ({ page }) => {
	// Assuming we can navigate to an album page
	await page.goto('/album/123');
	await expect(page.locator('h1')).toContainText('Album'); // Adjust selector as needed
});

test('audio player controls are present', async ({ page }) => {
	await page.goto('/');
	// Look for play/pause buttons
	const playButton = page.locator('button').filter({ hasText: /play|▶️/ });
	await expect(playButton).toBeVisible();
});
