import { test, expect, type Page } from '@playwright/test';
import type { PlayableTrack } from '$lib/types';

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

const setUserPlaybackQuality = async (page: Page, quality: string) => {
	await page.evaluate((nextQuality) => {
		const payload = {
			version: 1,
			timestamp: Date.now(),
			data: {
				playbackQuality: nextQuality,
				convertAacToMp3: false,
				downloadCoversSeperately: false,
				performanceMode: 'low'
			}
		};
		localStorage.setItem('tidal-ui:user-preferences', JSON.stringify(payload));
		window.dispatchEvent(
			new StorageEvent('storage', {
				key: 'tidal-ui:user-preferences',
				newValue: JSON.stringify(payload)
			})
		);
	}, quality);
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
	await page.waitForFunction(() => typeof window.__tidalPlaybackMachineState === 'function');
	await page.waitForFunction(() => typeof window.__tidalSetPlaybackQuality === 'function');
	await page.waitForFunction(() => typeof window.__tidalSetPlaybackQuality === 'function');
	const searchInput = page.locator('input[placeholder*="Search"]');
	await searchInput.fill('test');
	await searchInput.press('Enter');

	const trackButton = page.getByRole('button', { name: /Mock Track/i }).first();
	await expect(trackButton).toBeVisible();
	await trackButton.click();
	await page.waitForFunction(() => {
		const snapshot = window.__tidalPlaybackMachineState?.() as
			| { currentTrackId: number | string | null; loadRequestId?: number }
			| undefined;
		return (
			snapshot &&
			snapshot.currentTrackId !== null &&
			typeof snapshot.loadRequestId === 'number' &&
			snapshot.loadRequestId > 0
		);
	});

	const previousRequestId = await page.evaluate(() => {
		const snapshot = window.__tidalPlaybackMachineState?.() as
			| { loadRequestId?: number }
			| undefined;
		return snapshot?.loadRequestId ?? 0;
	});
	const reloadRequested = page.waitForFunction((prevId) => {
		const snapshot = window.__tidalPlaybackMachineState?.() as
			| { loadRequestId?: number }
			| undefined;
		if (!snapshot || typeof snapshot.loadRequestId !== 'number') {
			return false;
		}
		return snapshot.loadRequestId > prevId;
	}, previousRequestId);
	await page.evaluate(() => {
		window.__tidalSetPlaybackQuality?.('LOW');
	});
	await reloadRequested;

	const playerTitle = page.getByRole('heading', { name: /Mock Track/i }).first();
	await expect(playerTitle).toBeVisible();
});

test('playback machine hook reflects the selected track', async ({ page }) => {
	await page.goto('/');
	await page.waitForFunction(() => typeof window.__tidalPlaybackMachineState === 'function');
	const searchInput = page.locator('input[placeholder*="Search"]');
	await searchInput.fill('test');
	await searchInput.press('Enter');

	const trackButton = page.getByRole('button', { name: /Mock Track/i }).first();
	await expect(trackButton).toBeVisible();
	const trackSelected = page.waitForFunction(() => {
		const snapshot = window.__tidalPlaybackMachineState?.();
		return snapshot && snapshot.currentTrackId !== null;
	});
	await trackButton.click();
	await trackSelected;
});

test('queue gate keeps machine queue index in sync', async ({ page }) => {
	await page.goto('/');
	await page.waitForFunction(() => typeof window.__tidalPlaybackMachineState === 'function');
	await page.waitForFunction(() => typeof window.__tidalSetQueue === 'function');
	const queueTracks = [buildTrack(301, 'Queue Track A'), buildTrack(302, 'Queue Track B')];
	await page.evaluate((tracks: unknown) => {
		window.__tidalSetQueue?.(tracks as PlayableTrack[], 0);
	}, queueTracks);

	await page.waitForFunction(() => {
		const snapshot = window.__tidalPlaybackMachineState?.() as
			| { queueIndex?: number; queueLength?: number }
			| undefined;
		return snapshot?.queueIndex === 0 && snapshot?.queueLength === 2;
	});

	const nextButton = page.getByRole('button', { name: /Next track/i }).first();
	await expect(nextButton).toBeVisible();
	await expect(nextButton).toBeEnabled();
	await nextButton.click();

	await page.waitForFunction(() => {
		const snapshot = window.__tidalPlaybackMachineState?.() as
			| { queueIndex?: number; queueLength?: number }
			| undefined;
		return snapshot?.queueIndex === 1 && snapshot.queueLength === 2;
	});
});

test('queue shuffle keeps machine queue index coherent under gate', async ({ page }) => {
	const shuffleTracks = [buildTrack(401, 'Shuffle Track A'), buildTrack(402, 'Shuffle Track B')];
	await page.route('**/api/proxy**', async (route) => {
		const proxied = getProxiedUrl(route.request().url());
		if (proxied?.pathname.toLowerCase().includes('/search/')) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: shuffleTracks
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
	await page.waitForFunction(() => typeof window.__tidalPlaybackMachineState === 'function');
	await page.waitForFunction(() => typeof window.__tidalSetQueue === 'function');
	const searchInput = page.locator('input[placeholder*="Search"]');
	await searchInput.fill('shuffle');
	await searchInput.press('Enter');

	const firstTrack = page.getByRole('button', { name: /Shuffle Track A/i }).first();
	await expect(firstTrack).toBeVisible();
	await firstTrack.click();
	await page.evaluate((tracks: unknown) => {
		window.__tidalSetQueue?.(tracks as PlayableTrack[], 0);
	}, shuffleTracks);

	await page.evaluate(() => {
		window.__tidalShuffleQueue?.();
	});

	await page.waitForFunction(() => {
		const snapshot = window.__tidalPlaybackMachineState?.() as
			| { queueIndex?: number; queueLength?: number }
			| undefined;
		return snapshot?.queueIndex === 0 && snapshot?.queueLength === 2;
	});

	await page.waitForFunction(() => {
		const snapshot = window.__tidalPlaybackMachineState?.() as
			| { queueIndex?: number; queueLength?: number }
			| undefined;
		return snapshot?.queueIndex === 0 && snapshot?.queueLength === 2;
	});
});

test('quality change via preferences triggers reload when gated', async ({ page }) => {
	await page.goto('/');
	await page.waitForFunction(() => typeof window.__tidalPlaybackMachineState === 'function');
	const searchInput = page.locator('input[placeholder*="Search"]');
	await searchInput.fill('test');
	await searchInput.press('Enter');

	const trackButton = page.getByRole('button', { name: /Mock Track/i }).first();
	await expect(trackButton).toBeVisible();
	await trackButton.click();

	await page.waitForFunction(() => {
		const snapshot = window.__tidalPlaybackMachineState?.() as
			| { currentTrackId: number | string | null; loadRequestId?: number }
			| undefined;
		return (
			snapshot &&
			snapshot.currentTrackId !== null &&
			typeof snapshot.loadRequestId === 'number' &&
			snapshot.loadRequestId > 0
		);
	});

	const previousRequestId = await page.evaluate(() => {
		const snapshot = window.__tidalPlaybackMachineState?.() as
			| { loadRequestId?: number }
			| undefined;
		return snapshot?.loadRequestId ?? 0;
	});

	await setUserPlaybackQuality(page, 'LOW');
	await page.waitForFunction((prevId) => {
		const snapshot = window.__tidalPlaybackMachineState?.() as
			| { loadRequestId?: number; quality?: string }
			| undefined;
		if (!snapshot || typeof snapshot.loadRequestId !== 'number') {
			return false;
		}
		return snapshot.loadRequestId > prevId && snapshot.quality === 'LOW';
	}, previousRequestId);
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
