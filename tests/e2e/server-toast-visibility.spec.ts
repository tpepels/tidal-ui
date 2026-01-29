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

const buildTrackLookup = (track: ReturnType<typeof buildTrack>) => {
	const manifestPayload = Buffer.from(
		JSON.stringify({ urls: ['https://example.com/audio.mp3'] })
	).toString('base64');
	return [
		track,
		{
			trackId: track.id,
			audioQuality: 'LOSSLESS',
			audioMode: 'STEREO',
			manifest: manifestPayload,
			manifestMimeType: 'application/json',
			assetPresentation: 'FULL'
		}
	];
};

test('server download toasts render without opening settings', async ({ page }) => {
	await page.addInitScript(() => {
		localStorage.setItem('tidal-ui.downloadStorage', 'server');
		localStorage.setItem('tidal-ui.downloadMode', 'individual');
	});

	const artist = buildArtist(901, 'Toast Artist');
	const album = buildAlbum(902, 'Toast Album', artist);
	const track = buildTrack(903, 'Toast Track', artist, album);

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
					data: { items: [{ item: track }] }
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

	await page.route('**/api/download-track**', async (route) => {
		if (route.request().method() !== 'POST') {
			await route.continue();
			return;
		}
		const body = route.request().postDataJSON() as Record<string, unknown> | null;
		if (body && typeof body.uploadId === 'string') {
			await route.fulfill({
				status: 201,
				contentType: 'application/json',
				body: JSON.stringify({
					success: true,
					filepath: '/tmp/toast.flac',
					message: 'Saved to server',
					action: 'overwrite'
				})
			});
			return;
		}

		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				uploadId: 'upload-1',
				chunked: false,
				totalChunks: 0
			})
		});
	});

	await page.goto(`/album/${album.id}`);
	const downloadButton = page.getByRole('button', { name: /Download album/i });
	await expect(downloadButton).toBeVisible();
	await downloadButton.click();

	const toast = page.locator('.toast-message', { hasText: 'Download completed' });
	await expect(toast).toBeVisible();
});
