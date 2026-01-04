import { test, expect, type Page } from '@playwright/test';

type TrackPayload = {
	id: number;
	title: string;
	duration: number;
	trackNumber: number;
	volumeNumber: number;
	explicit: boolean;
	isrc: string;
	audioQuality: string;
	audioModes: string[];
	allowStreaming: boolean;
	streamReady: boolean;
	streamStartDate: string;
	premiumStreamingOnly: boolean;
	replayGain: number;
	peak: number;
	artist: { id: number; name: string; url: string; picture: string };
	artists: { id: number; name: string; url: string; picture: string }[];
	album: {
		id: number;
		title: string;
		cover: string;
		releaseDate: string;
		numberOfTracks: number;
		numberOfVolumes: number;
		duration: number;
	};
};

const buildTrack = (id: number, title: string): TrackPayload => ({
	id,
	title,
	duration: 180,
	trackNumber: 1,
	volumeNumber: 1,
	explicit: false,
	isrc: 'TEST123',
	audioQuality: 'LOSSLESS',
	audioModes: ['STEREO'],
	allowStreaming: true,
	streamReady: true,
	streamStartDate: '2020-01-01',
	premiumStreamingOnly: false,
	replayGain: -6.5,
	peak: 0.95,
	artist: { id: 1, name: 'Test Artist', url: '', picture: '' },
	artists: [{ id: 1, name: 'Test Artist', url: '', picture: '' }],
	album: {
		id: 1,
		title: 'Test Album',
		cover: '',
		releaseDate: '2020-01-01',
		numberOfTracks: 10,
		numberOfVolumes: 1,
		duration: 1800
	}
});

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getProxiedUrl = (requestUrl: string): URL | null => {
	try {
		const url = new URL(requestUrl);
		const proxied = url.searchParams.get('url');
		return proxied ? new URL(proxied) : null;
	} catch {
		return null;
	}
};

const setUserPreferences = async (
	page: Page,
	preferences: {
		playbackQuality: string;
		convertAacToMp3: boolean;
		downloadCoversSeperately: boolean;
		performanceMode: string;
	}
) => {
	await page.evaluate((nextPreferences) => {
		const payload = {
			version: 1,
			timestamp: Date.now(),
			data: nextPreferences
		};
		localStorage.setItem('tidal-ui:user-preferences', JSON.stringify(payload));
		window.dispatchEvent(
			new StorageEvent('storage', {
				key: 'tidal-ui:user-preferences',
				newValue: JSON.stringify(payload)
			})
		);
	}, preferences);
};

const setRegion = async (page: Page, region: 'auto' | 'us' | 'eu') => {
	await page.evaluate((nextRegion) => {
		if (window.__tidalSetRegion) {
			window.__tidalSetRegion(nextRegion);
			return;
		}
		localStorage.setItem('tidal-ui.region', nextRegion);
		window.dispatchEvent(
			new StorageEvent('storage', { key: 'tidal-ui.region', newValue: nextRegion })
		);
	}, region);
	await page.waitForFunction(
		(expected) => localStorage.getItem('tidal-ui.region') === expected,
		region
	);
};

test('rapid track switches keep the latest track', async ({ page }) => {
	await page.route('**/api/proxy**', async (route) => {
		const proxied = getProxiedUrl(route.request().url());
		if (proxied?.pathname.toLowerCase().includes('/search/')) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: [buildTrack(101, 'Alpha Track'), buildTrack(202, 'Beta Track')]
				})
			});
			return;
		}

		try {
			await route.continue();
		} catch {
			// Ignore aborted requests after cancelation.
		}
	});

	await page.goto('/');
	const searchInput = page.locator('input[placeholder*="Search"]');
	await searchInput.fill('race');
	await searchInput.press('Enter');

	const alpha = page.getByRole('button', { name: /Alpha Track/i }).first();
	const beta = page.getByRole('button', { name: /Beta Track/i }).first();
	await expect(alpha).toBeVisible();
	await expect(beta).toBeVisible();

	await alpha.click();
	await beta.click();

	const playerTitle = page.getByRole('heading', { name: /Beta Track/i }).first();
	await expect(playerTitle).toBeVisible();
});

test('download cancel resets button state', async ({ page }) => {
	await page.route('**/api/proxy**', async (route) => {
		const proxied = getProxiedUrl(route.request().url());
		if (proxied && proxied.hostname === 'example.com' && proxied.pathname === '/audio.mp3') {
			await delay(1500);
		}
		try {
			await route.continue();
		} catch {
			// Ignore aborted requests after cancelation.
		}
	});

	await page.goto('/');
	const searchInput = page.locator('input[placeholder*="Search"]');
	await searchInput.fill('test');
	await searchInput.press('Enter');

	const trackRow = page
		.locator('div[role="button"]')
		.filter({ hasText: 'Mock Track' })
		.first();
	await expect(trackRow).toBeVisible();

	const downloadButton = trackRow.locator('button').first();
	await expect(downloadButton).toBeVisible();

	await downloadButton.click();
	await expect(downloadButton).toHaveAttribute('aria-label', /Cancel download/i);

	await downloadButton.click();
	await expect(downloadButton).toHaveAttribute('aria-label', /Download/i);
});

test('quality change triggers a new playback load', async ({ page }) => {
	await page.goto('/');
	const searchInput = page.locator('input[placeholder*="Search"]');
	await searchInput.fill('test');
	await searchInput.press('Enter');

	const trackButton = page.getByRole('button', { name: /Mock Track/i }).first();
	await expect(trackButton).toBeVisible();
	const initialLoad = page.waitForResponse((response) => {
		const proxied = getProxiedUrl(response.url());
		if (!proxied) return false;
		return proxied.pathname.includes('/track/') && proxied.searchParams.get('quality') === 'LOSSLESS';
	});
	await trackButton.click();
	await initialLoad;

	const qualityLoad = page.waitForResponse((response) => {
		const proxied = getProxiedUrl(response.url());
		if (!proxied) return false;
		return proxied.pathname.includes('/track/') && proxied.searchParams.get('quality') === 'LOW';
	});

	await setUserPreferences(page, {
		playbackQuality: 'LOW',
		convertAacToMp3: false,
		downloadCoversSeperately: false,
		performanceMode: 'low'
	});
	await qualityLoad;

	const playerTitle = page.getByRole('heading', { name: /Mock Track/i }).first();
	await expect(playerTitle).toBeVisible();
});

test('region switch triggers fresh search results', async ({ page }) => {
	let searchCount = 0;
	await page.route('**/api/proxy**', async (route) => {
		const proxied = getProxiedUrl(route.request().url());
		if (proxied?.pathname.toLowerCase().includes('/search/')) {
			searchCount += 1;
			const title = searchCount === 1 ? 'Auto Track' : 'US Track';
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ items: [buildTrack(searchCount, title)] })
			});
			return;
		}

		try {
			await route.continue();
		} catch {
			// Ignore aborted requests after cancelation.
		}
	});

	await page.goto('/?testRegion=auto');
	const searchInput = page.locator('input[placeholder*="Search"]');
	await searchInput.fill('region');
	await searchInput.press('Enter');
	const autoTrack = page.getByRole('button', { name: /Auto Track/i }).first();
	await expect(autoTrack).toBeVisible();

	await setRegion(page, 'us');
	await searchInput.fill('region');
	await searchInput.press('Enter');
	const usTrack = page.getByRole('button', { name: /US Track/i }).first();
	await expect(usTrack).toBeVisible();
	await expect(page.getByText('Auto Track')).toHaveCount(0);
});

test('seek updates the playback time display', async ({ page, browserName }) => {
	test.skip(browserName === 'firefox', 'Firefox does not reliably update seek UI in test env.');
	await page.goto('/');
	const searchInput = page.locator('input[placeholder*="Search"]');
	await searchInput.fill('test');
	await searchInput.press('Enter');

	const trackButton = page.getByRole('button', { name: /Mock Track/i }).first();
	await expect(trackButton).toBeVisible();
	await trackButton.click();

	const playerTitle = page.getByRole('heading', { name: /Mock Track/i }).first();
	await expect(playerTitle).toBeVisible();

	await page.waitForFunction(() => typeof window.__tidalSetDuration === 'function');
	await page.evaluate(() => {
		window.__tidalSetDuration?.(120);
	});
	const durationLabel = page.locator('.audio-player-glass .mt-1 span').nth(1);
	await expect(durationLabel).toHaveText('2:00');

	await page.waitForFunction(() => typeof window.__tidalSetCurrentTime === 'function');
	await page.evaluate(() => {
		window.__tidalSetCurrentTime?.(42);
	});

	const timeLabel = page.locator('.audio-player-glass .mt-1 span').first();
	await expect(timeLabel).toHaveText('0:42');
});

test('track end advances to the next queued track', async ({ page }) => {
	await page.route('**/api/proxy**', async (route) => {
		const proxied = getProxiedUrl(route.request().url());
		if (proxied?.pathname.toLowerCase().includes('/search/')) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: [buildTrack(111, 'Alpha Track'), buildTrack(222, 'Beta Track')]
				})
			});
			return;
		}

		try {
			await route.continue();
		} catch {
			// Ignore aborted requests after cancelation.
		}
	});

	await page.goto('/');
	const searchInput = page.locator('input[placeholder*="Search"]');
	await searchInput.fill('queue');
	await searchInput.press('Enter');

	const alpha = page.getByRole('button', { name: /Alpha Track/i }).first();
	const betaRow = page
		.locator('div[role="button"]')
		.filter({ hasText: 'Beta Track' })
		.first();
	await expect(alpha).toBeVisible();
	await expect(betaRow).toBeVisible();

	await alpha.click();

	const betaMenuButton = betaRow.locator('button[aria-label^="Queue actions"]');
	await expect(betaMenuButton).toBeVisible();
	await betaMenuButton.click();

	const playNext = betaRow.locator('.track-menu-container').getByRole('button', { name: /Play Next/i });
	await expect(playNext).toBeVisible();
	await playNext.click();

	const playerTitle = page.getByRole('heading', { name: /Alpha Track/i }).first();
	await expect(playerTitle).toBeVisible();

	await page.evaluate(() => {
		const audio = document.querySelector('audio');
		audio?.dispatchEvent(new Event('ended'));
	});

	const nextTitle = page.getByRole('heading', { name: /Beta Track/i }).first();
	await expect(nextTitle).toBeVisible();
});
