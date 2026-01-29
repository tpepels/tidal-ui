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
	numberOfTracks: 2,
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
	quality: string = 'LOSSLESS',
	url: string
) => {
	const manifestPayload = Buffer.from(
		JSON.stringify({ urls: [url] })
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

test('playing an album resets queue and plays the album track', async ({ page }) => {
	await page.addInitScript(() => {
		(window as Window & { __playSrcs?: string[] }).__playSrcs = [];
		const originalPlay = HTMLMediaElement.prototype.play;
		const originalPause = HTMLMediaElement.prototype.pause;
		HTMLMediaElement.prototype.play = function () {
			try {
				const playSrcs = (window as Window & { __playSrcs?: string[] }).__playSrcs;
				const src = (this as HTMLMediaElement).currentSrc || (this as HTMLMediaElement).src;
				if (playSrcs && src) {
					playSrcs.push(src);
				}
			} catch {
				// ignore
			}
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

	const artist = buildArtist(101, 'Queue Artist');
	const album = buildAlbum(201, 'Queue Album', artist);
	const previousTrack = buildTrack(301, 'Previous Track', artist, album);
	const albumTrack1 = buildTrack(401, 'Album Track 1', artist, album);
	const albumTrack2 = buildTrack(402, 'Album Track 2', artist, album);
	const urlMap = new Map<number, string>([
		[previousTrack.id, 'https://example.com/audio-prev.mp3'],
		[albumTrack1.id, 'https://example.com/audio-album-1.mp3'],
		[albumTrack2.id, 'https://example.com/audio-album-2.mp3']
	]);

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
					items: [previousTrack],
					totalNumberOfItems: 1,
					limit: 1,
					offset: 0
				})
			});
			return;
		}

		if (path.includes('/album/')) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					version: '2.0',
					data: {
						items: [{ item: albumTrack1 }, { item: albumTrack2 }]
					}
				})
			});
			return;
		}

		if (path.includes('/track/')) {
			const id = Number.parseInt(decoded.searchParams.get('id') || '0', 10);
			const track = id === albumTrack1.id ? albumTrack1 : id === albumTrack2.id ? albumTrack2 : previousTrack;
			const url = urlMap.get(track.id) ?? 'https://example.com/audio-default.mp3';
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(buildTrackLookup(track, 'LOSSLESS', url))
			});
			return;
		}

		if (path.includes('/url/')) {
			const id = Number.parseInt(decoded.searchParams.get('id') || '0', 10);
			const url = urlMap.get(id) ?? 'https://example.com/audio-default.mp3';
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ url })
			});
			return;
		}

		if (decoded.hostname === 'example.com' && decoded.pathname.startsWith('/audio')) {
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
	await searchInput.fill('queue');
	await searchInput.press('Enter');

	const previousTrackButton = page.getByRole('button', { name: /Previous Track/i }).first();
	await expect(previousTrackButton).toBeVisible();
	await previousTrackButton.click();

	const previousHeading = page.getByRole('heading', { name: /Previous Track/i }).first();
	await expect(previousHeading).toBeVisible();

	await page.goto(`/album/${album.id}`);
	const playAlbumButton = page.getByRole('button', { name: 'Play album', exact: true });
	await expect(playAlbumButton).toBeVisible();
	await playAlbumButton.click();

	const albumHeading = page.getByRole('heading', { name: /Album Track 1/i }).first();
	await expect(albumHeading).toBeVisible();

	const state = await page.evaluate(() => window.__tidalPlaybackMachineState?.());
	expect(state?.currentTrackId).toBe(401);
	expect(state?.queueLength).toBe(2);

	await expect
		.poll(async () => {
			return await page.evaluate(() => window.__playSrcs ?? []);
		})
		.toEqual(expect.arrayContaining([expect.stringContaining('audio-album-1.mp3')]));
});

test('album play button reflects player state and restarts from first track', async ({ page }) => {
	await page.addInitScript(() => {
		(window as Window & { __playingEvents?: number }).__playingEvents = 0;
		const originalPlay = HTMLMediaElement.prototype.play;
		HTMLMediaElement.prototype.play = function () {
			const state = window as Window & { __playingEvents?: number };
			state.__playingEvents = (state.__playingEvents ?? 0) + 1;
			try {
				this.dispatchEvent(new Event('playing'));
			} catch {
				// ignore
			}
			return Promise.resolve();
		};
		void originalPlay;
	});

	const artist = buildArtist(201, 'State Artist');
	const album = buildAlbum(301, 'State Album', artist);
	const albumTrack1 = buildTrack(501, 'State Track 1', artist, album);
	const albumTrack2 = buildTrack(502, 'State Track 2', artist, album);
	const urlMap = new Map<number, string>([
		[albumTrack1.id, 'https://example.com/audio-state-1.mp3'],
		[albumTrack2.id, 'https://example.com/audio-state-2.mp3']
	]);

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

		if (path.includes('/album/')) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					version: '2.0',
					data: {
						items: [{ item: albumTrack1 }, { item: albumTrack2 }]
					}
				})
			});
			return;
		}

		if (path.includes('/track/')) {
			const id = Number.parseInt(decoded.searchParams.get('id') || '0', 10);
			const track = id === albumTrack2.id ? albumTrack2 : albumTrack1;
			const url = urlMap.get(track.id) ?? 'https://example.com/audio-default.mp3';
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(buildTrackLookup(track, 'LOSSLESS', url))
			});
			return;
		}

		if (path.includes('/url/')) {
			const id = Number.parseInt(decoded.searchParams.get('id') || '0', 10);
			const url = urlMap.get(id) ?? 'https://example.com/audio-default.mp3';
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ url })
			});
			return;
		}

		if (decoded.hostname === 'example.com' && decoded.pathname.startsWith('/audio')) {
			await route.fulfill({
				status: 200,
				contentType: 'audio/wav',
				body: 'RIFF'
			});
			return;
		}

		await route.continue();
	});

	await page.goto(`/album/${album.id}`);
	const playAlbumButton = page.getByRole('button', { name: 'Play album', exact: true });
	await expect(playAlbumButton).toBeVisible();
	await playAlbumButton.click();

	const pauseAlbumButton = page.getByRole('button', { name: 'Pause album', exact: true });
	await expect(pauseAlbumButton).toBeVisible();

	await page.waitForFunction(() => typeof window.__tidalNext === 'function');
	await page.evaluate(() => {
		window.__tidalNext?.();
	});
	await page.waitForFunction(() => {
		const snapshot = window.__tidalPlaybackMachineState?.();
		return snapshot?.currentTrackId === 502;
	});

	const playerPauseButton = page.getByRole('button', { name: 'Pause', exact: true }).first();
	await playerPauseButton.click();

	await expect(playAlbumButton).toBeVisible();

	await playAlbumButton.click();

	await page.waitForFunction(() => {
		const snapshot = window.__tidalPlaybackMachineState?.();
		return snapshot?.currentTrackId === 501;
	});

	await expect
		.poll(async () => {
			return await page.evaluate(() => window.__playingEvents ?? 0);
		})
		.toBeGreaterThan(1);
});
