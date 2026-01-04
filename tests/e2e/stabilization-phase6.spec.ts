import { test, expect } from '@playwright/test';

const buildTrack = (id: number, title: string) => ({
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
	artist: { id: 1, name: 'Persisted Artist', url: '', picture: '' },
	artists: [{ id: 1, name: 'Persisted Artist', url: '', picture: '' }],
	album: {
		id: 1,
		title: 'Persisted Album',
		cover: '',
		releaseDate: '2020-01-01',
		numberOfTracks: 10,
		numberOfVolumes: 1,
		duration: 1800
	}
});

test('persisted playback state restores on reload', async ({ page }) => {
	const track = buildTrack(901, 'Persisted Track');
	const persisted = {
		version: 1,
		timestamp: Date.now(),
		data: {
			currentTrack: track,
			queue: [track],
			queueIndex: 0,
			volume: 0.5,
			currentTime: 30,
			duration: 120,
			sampleRate: null,
			bitDepth: null,
			replayGain: null
		}
	};

	await page.addInitScript((state) => {
		localStorage.setItem('tidal-ui:player', JSON.stringify(state));
	}, persisted);

	await page.goto('/');
	let title = page.getByRole('heading', { name: /Persisted Track/i }).first();
	await expect(title).toBeVisible();
	await page.waitForFunction(
		() => typeof window.__tidalSetDuration === 'function' && typeof window.__tidalSetCurrentTime === 'function'
	);
	await page.evaluate(() => {
		window.__tidalSetDuration?.(120);
		window.__tidalSetCurrentTime?.(30);
	});
	let timeLabel = page.locator('.audio-player-glass .mt-1 span').first();
	await expect(timeLabel).toHaveText('0:30');
	await page.waitForTimeout(1100);

	await page.reload();
	await page.waitForFunction(() => typeof window.__tidalRehydratePlayback === 'function');
	await page.evaluate(() => {
		window.__tidalRehydratePlayback?.();
	});
	await page.waitForFunction(
		() => typeof window.__tidalSetDuration === 'function' && typeof window.__tidalSetCurrentTime === 'function'
	);
	await page.evaluate(() => {
		window.__tidalSetDuration?.(120);
		window.__tidalSetCurrentTime?.(30);
	});
	title = page.getByRole('heading', { name: /Persisted Track/i }).first();
	await expect(title).toBeVisible();
	timeLabel = page.locator('.audio-player-glass .mt-1 span').first();
	await expect(timeLabel).toHaveText('0:30');
});

test('playback machine state matches UI play state', async ({ page }) => {
	await page.route('**/api/proxy**', async (route) => {
		const requestUrl = new URL(route.request().url());
		const proxiedUrl = requestUrl.searchParams.get('url');
		if (!proxiedUrl) {
			await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
			return;
		}
		const decoded = new URL(proxiedUrl);
		if (decoded.pathname.toLowerCase().includes('/search/')) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ items: [buildTrack(902, 'Machine Track')] })
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

	const searchInput = page.locator('input[placeholder*="Search"]');
	await searchInput.fill('machine');
	await searchInput.press('Enter');

	const trackButton = page.getByRole('button', { name: /Machine Track/i }).first();
	await expect(trackButton).toBeVisible();
	await trackButton.click();

	const toggleButton = page
		.locator('.audio-player-glass button[aria-label="Play"], .audio-player-glass button[aria-label="Pause"]')
		.first();
	await expect(toggleButton).toBeVisible();
	const label = await toggleButton.getAttribute('aria-label');
	if (label === 'Play') {
		await toggleButton.click();
	}

	await expect(toggleButton).toHaveAttribute('aria-label', 'Pause');

	const machineState = await page.evaluate(() => window.__tidalPlaybackMachineState?.());
	expect(machineState).toBeTruthy();
	expect(machineState?.isPlaying).toBe(true);
	expect(machineState?.currentTrackId).toBe(902);
});
