import { test, expect } from '@playwright/test';

const buildArtist = (id: number, name: string) => ({
	id,
	name,
	type: 'artist',
	picture: '',
	url: `https://example.com/artist/${id}`,
	popularity: 1,
	artistTypes: ['MAIN'],
	artistRoles: []
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

test('artist loading UI uses spinner without fake progress', async ({ page }) => {
	const artist = buildArtist(901, 'Loading Artist');
	const album = buildAlbum(902, 'Loading Album', artist);
	const track = buildTrack(903, 'Loading Track', artist, album);
	let resolveArtist: (() => void) | undefined;
	const artistGate = new Promise<void>((resolve) => {
		resolveArtist = () => resolve();
	});

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

		if (path.includes('/artist/')) {
			await artistGate;
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([track])
			});
			return;
		}

		await route.continue();
	});

	await page.goto(`/artist/${artist.id}`);
	const spinner = page.getByTestId('artist-loading-spinner');
	await expect(spinner).toBeVisible();
	await expect(page.getByTestId('artist-loading-progress')).toHaveCount(0);

	resolveArtist?.();
	await expect(page.getByRole('heading', { name: artist.name })).toBeVisible();
});

test('breadcrumb navigation uses cached artist data without loading interstitial', async ({ page }) => {
	const artist = buildArtist(701, 'Cached Artist');
	const album = buildAlbum(702, 'Cached Album', artist);
	const track1 = buildTrack(703, 'Cached Track 1', artist, album);
	const track2 = buildTrack(704, 'Cached Track 2', artist, album);
	let artistFetchCount = 0;

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

		if (path.includes('/artist/')) {
			artistFetchCount += 1;
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([track1, track2])
			});
			return;
		}

		if (path.includes('/album/')) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					version: '2.0',
					data: { items: [{ item: track1 }, { item: track2 }] }
				})
			});
			return;
		}

		await route.continue();
	});

	await page.goto(`/artist/${artist.id}`);
	await expect(page.getByRole('heading', { name: artist.name })).toBeVisible();
	expect(artistFetchCount).toBe(1);

	await page.goto(`/album/${album.id}`);
	const breadcrumbLink = page.getByLabel('Breadcrumb').getByRole('link', { name: artist.name });
	await expect(breadcrumbLink).toBeVisible();
	await breadcrumbLink.click();
	await page.waitForURL(`/artist/${artist.id}`);
	await expect(page.getByRole('heading', { name: artist.name })).toBeVisible();
	await expect(page.getByText('Loading artist data')).toHaveCount(0);
	expect(artistFetchCount).toBe(1);
});
