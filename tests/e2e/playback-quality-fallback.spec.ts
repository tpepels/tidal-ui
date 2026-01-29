import { test, expect } from '@playwright/test';

const buildArtist = (id: number, name: string) => ({
	id,
	name,
	type: 'artist',
	picture: '',
	url: `https://example.com/artist/${id}`,
	popularity: 1
});

const buildAlbum = (id: number, title: string, artist: ReturnType<typeof buildArtist>) => ({
	id,
	title,
	cover: 'mock-cover',
	videoCover: null,
	releaseDate: '2024-01-01',
	duration: 2400,
	numberOfTracks: 1,
	numberOfVideos: 0,
	numberOfVolumes: 1,
	explicit: false,
	popularity: 1,
	type: 'album',
	upc: '000000000000',
	artist,
	artists: [artist]
});

const buildTrack = (
	id: number,
	title: string,
	artist: ReturnType<typeof buildArtist>,
	album: ReturnType<typeof buildAlbum>
) => ({
	id,
	title,
	duration: 180,
	trackNumber: 1,
	volumeNumber: 1,
	explicit: false,
	isrc: `TEST${id}`,
	audioQuality: 'LOSSLESS',
	audioModes: ['STEREO'],
	allowStreaming: true,
	streamReady: true,
	streamStartDate: '2024-01-01',
	premiumStreamingOnly: false,
	replayGain: -6.5,
	peak: 0.95,
	version: null,
	popularity: 1,
	url: `https://example.com/track/${id}`,
	artist,
	artists: [artist],
	album,
	mixes: {},
	mediaMetadata: { tags: [] }
});

const buildTrackLookup = (
	track: ReturnType<typeof buildTrack>,
	quality: string = 'LOSSLESS'
) => {
	const manifestPayload = Buffer.from(
		JSON.stringify({ urls: ['https://example.com/audio.mp3'] })
	).toString('base64');
	return [
		track,
		{
			trackId: track.id,
			audioQuality: quality,
			audioMode: 'STEREO',
			manifest: manifestPayload,
			manifestMimeType: 'application/json',
			assetPresentation: 'FULL'
		}
	];
};

test('quality fallback retries playback after downgrade', async ({ page }) => {
	await page.addInitScript(() => {
		(window as Window & {
			__playCalls?: number;
			__playingEvents?: number;
			__suppressNextPlayingEvent?: boolean;
		}).__playCalls = 0;
		(window as Window & {
			__playCalls?: number;
			__playingEvents?: number;
			__suppressNextPlayingEvent?: boolean;
		}).__playingEvents = 0;
		(window as Window & {
			__playCalls?: number;
			__playingEvents?: number;
			__suppressNextPlayingEvent?: boolean;
		}).__suppressNextPlayingEvent = false;

		const originalPlay = HTMLMediaElement.prototype.play;
		const originalPause = HTMLMediaElement.prototype.pause;
		const originalLoad = HTMLMediaElement.prototype.load;

		HTMLMediaElement.prototype.play = function () {
			const state = window as Window & {
				__playCalls?: number;
				__playingEvents?: number;
				__suppressNextPlayingEvent?: boolean;
			};
			state.__playCalls = (state.__playCalls ?? 0) + 1;
			if (state.__suppressNextPlayingEvent) {
				state.__suppressNextPlayingEvent = false;
				return Promise.resolve();
			}
			state.__playingEvents = (state.__playingEvents ?? 0) + 1;
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

		HTMLMediaElement.prototype.load = function () {
			const result = originalLoad.apply(this);
			setTimeout(() => {
				try {
					this.dispatchEvent(new Event('loadeddata'));
				} catch {
					// ignore
				}
			}, 0);
			return result;
		};

		void originalPlay;
	});

	const artist = buildArtist(211, 'Fallback Artist');
	const album = buildAlbum(311, 'Fallback Album', artist);
	const track = buildTrack(411, 'Fallback Track', artist, album);

	await page.route('**/api/proxy**', async (route) => {
		const requestUrl = new URL(route.request().url());
		const proxiedUrl = requestUrl.searchParams.get('url');
		if (!proxiedUrl) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ items: [] })
			});
			return;
		}
		const decoded = new URL(proxiedUrl);
		const path = decoded.pathname.toLowerCase();

		if (path.includes('/search/')) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					items: [track],
					totalNumberOfItems: 1,
					limit: 1,
					offset: 0
				})
			});
			return;
		}

		if (path.includes('/track/')) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(buildTrackLookup(track))
			});
			return;
		}

		if (path.includes('/url/')) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ url: 'https://example.com/audio.mp3' })
			});
			return;
		}

		if (decoded.hostname === 'example.com' && decoded.pathname === '/audio.mp3') {
			await route.fulfill({
				status: 200,
				contentType: 'audio/wav',
				body: 'RIFF'
			});
			return;
		}

		await route.continue();
	});

	await page.goto('/');
	const searchInput = page.locator('input[placeholder*="Search"]');
	await searchInput.fill('fallback');
	await searchInput.press('Enter');

	const trackButton = page.getByRole('button', { name: /Fallback Track/i }).first();
	await expect(trackButton).toBeVisible();
	await trackButton.click();

	await page.waitForFunction(() => {
		return window.__tidalPlaybackMachineState?.().state === 'playing';
	});

	await page.evaluate(() => {
		window.__tidalSetPlaybackQuality?.('LOSSLESS');
	});

	const initialLoadId = await page.evaluate(
		() => window.__tidalPlaybackMachineState?.().loadRequestId ?? 0
	);

	await page.evaluate(() => {
		const state = window as Window & {
			__suppressNextPlayingEvent?: boolean;
		};
		state.__suppressNextPlayingEvent = true;
		const audio = document.querySelector('audio');
		if (!audio) return;
		const error = {
			code: 4,
			MEDIA_ERR_ABORTED: 1,
			MEDIA_ERR_DECODE: 3,
			MEDIA_ERR_SRC_NOT_SUPPORTED: 4
		};
		Object.defineProperty(audio, 'error', { configurable: true, value: error });
		audio.dispatchEvent(new Event('error'));
	});

	await page.waitForFunction((initial) => {
		const state = window.__tidalPlaybackMachineState?.();
		return !!state && state.loadRequestId > initial;
	}, initialLoadId);

	await expect
		.poll(async () => {
			return await page.evaluate(() => window.__playingEvents ?? 0);
		})
		.toBe(2);
});
