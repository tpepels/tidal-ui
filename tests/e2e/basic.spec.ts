import { test, expect } from '@playwright/test';

test('homepage loads', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveTitle(/BiniLossless/);
});

test('search interface is visible', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('input[placeholder*="Search"]')).toBeVisible();
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
	await page.goto('/track/789', { waitUntil: 'domcontentloaded' });
	await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
	await expect(
		page.locator('button[aria-label="Play"], button[aria-label="Pause"]')
	).toBeVisible({ timeout: 15000 });
});

test('can navigate between pages', async ({ page }) => {
	await page.goto('/album/123');
	const artistLink = page.locator('a[href^="/artist/"]').first();
	await expect(artistLink).toBeVisible();
	await artistLink.click();
	await page.waitForURL(/\/artist\//);
	await expect(page.url()).toContain('/artist/');
});

test('search results show tracks', async ({ page }) => {
	await page.goto('/');
	const searchInput = page.locator('input[placeholder*="Search"]');
	await searchInput.fill('test');
	await searchInput.press('Enter');
	const trackResults = page.locator('.track-glass').first();
	await expect(trackResults).toBeVisible();
});

test('error handling for invalid routes', async ({ page }) => {
	await page.goto('/invalid-route');
	await expect(page.locator('text=Not Found')).toBeVisible();
});
