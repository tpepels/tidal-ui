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
	await expect(page.locator('h1')).toBeVisible();
});

test('navigation to artist page', async ({ page }) => {
	await page.goto('/artist/456');
	await expect(page.locator('h1')).toBeVisible();
});

test('navigation to playlist page', async ({ page }) => {
	await page.goto('/playlist/test-uuid');
	await expect(page.locator('h1')).toBeVisible();
});

test('navigation to track page', async ({ page }) => {
	await page.goto('/track/789');
	await expect(page.locator('h1')).toBeVisible();
});

test('audio player controls are present', async ({ page }) => {
	await page.goto('/');
	// Look for play/pause buttons
	const playButton = page.locator('button').filter({ hasText: /play|▶️/ });
	await expect(playButton).toBeVisible();
});

test('can navigate between pages', async ({ page }) => {
	await page.goto('/');
	await page.click('a[href*="/album"]');
	await expect(page.url()).toContain('/album');
});

test('search results show tracks', async ({ page }) => {
	await page.goto('/?q=test');
	// Check if track results are displayed
	const trackResults = page.locator('[data-testid="track-result"]').first();
	await expect(trackResults).toBeVisible();
});

test('error handling for invalid routes', async ({ page }) => {
	await page.goto('/invalid-route');
	await expect(page.locator('text=Not Found')).toBeVisible();
});
