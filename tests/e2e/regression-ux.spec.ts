import { expect, test } from '@playwright/test';

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
	cover: `cover-${id}`,
	videoCover: null,
	releaseDate: '2024-01-01',
	duration: 2400,
	numberOfTracks: 2,
	numberOfVideos: 0,
	numberOfVolumes: 1,
	explicit: false,
	popularity: 1,
	type: 'ALBUM',
	upc: `${id}`.padStart(12, '0'),
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

function getProxiedUrl(requestUrl: string): URL | null {
	try {
		const url = new URL(requestUrl);
		const proxied = url.searchParams.get('url');
		return proxied ? new URL(proxied) : null;
	} catch {
		return null;
	}
}

function getUpstreamUrl(requestUrl: string): URL | null {
	try {
		const direct = new URL(requestUrl);
		if (direct.pathname.includes('/api/proxy')) {
			return getProxiedUrl(requestUrl);
		}
		if (
			(direct.hostname === '127.0.0.1' || direct.hostname === 'localhost') &&
			!direct.pathname.includes('/api/proxy')
		) {
			return null;
		}
		return direct;
	} catch {
		return null;
	}
}

test('artist page open does not loop API requests', async ({ page }) => {
	const artist = buildArtist(3521827, 'Loop Guard Artist');
	const album = buildAlbum(357997200, 'Stable Album', artist);
	const track = buildTrack(991, 'Stable Track', artist, album);
	let artistFetchCount = 0;

	await page.route('**/*', async (route) => {
		const upstream = getUpstreamUrl(route.request().url());
		if (!upstream) {
			await route.continue();
			return;
		}
		const path = upstream.pathname.toLowerCase();
		if (path.includes('/artist/')) {
			artistFetchCount += 1;
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
	await expect(page.getByRole('heading', { name: artist.name })).toBeVisible();
	await page.waitForTimeout(1500);
	expect(artistFetchCount).toBeLessThanOrEqual(2);
});

test('back navigation follows relative breadcrumb path after artist/album hops', async ({ page }) => {
	const artist = buildArtist(777, 'Breadcrumb Artist');
	const albumA = buildAlbum(880, 'Album A', artist);
	const albumB = buildAlbum(881, 'Album B', artist);
	const trackA = buildTrack(990, 'Track A', artist, albumA);
	const trackB = buildTrack(991, 'Track B', artist, albumB);

	await page.route('**/*', async (route) => {
		const upstream = getUpstreamUrl(route.request().url());
		if (!upstream) {
			await route.continue();
			return;
		}

		const path = upstream.pathname.toLowerCase();
		if (path.includes('/artist/')) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([trackA, trackB])
			});
			return;
		}

		if (path.includes('/album/')) {
			const id = Number.parseInt(upstream.searchParams.get('id') || '0', 10);
			const payloadTracks = id === albumB.id ? [trackB] : [trackA];
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					version: '2.0',
					data: {
						items: payloadTracks.map((item) => ({ item }))
					}
				})
			});
			return;
		}

		await route.continue();
	});

	await page.goto(`/artist/${artist.id}`);
	await expect(page.getByRole('heading', { name: artist.name })).toBeVisible();

	await page.goto(`/album/${albumA.id}`);
	await page.waitForURL(`/album/${albumA.id}`);

	await page.goto(`/artist/${artist.id}`);
	await page.waitForURL(`/artist/${artist.id}`);

	await page.goto(`/album/${albumB.id}`);
	await page.waitForURL(`/album/${albumB.id}`);

	await page.getByRole('button', { name: 'Back' }).first().click();
	await page.waitForURL(`/artist/${artist.id}`);
});

test('artwork remains visible across artist and album navigation', async ({ page }) => {
	const artist = buildArtist(9911, 'Artwork Artist');
	const album = buildAlbum(8811, 'Artwork Album', artist);
	const track = buildTrack(7711, 'Artwork Track', artist, album);
	let coverRequests = 0;

	await page.route('**/*', async (route) => {
		const upstream = getUpstreamUrl(route.request().url());
		if (!upstream) {
			await route.continue();
			return;
		}
		const path = upstream.pathname.toLowerCase();

		if (path.includes('/artist/')) {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([track])
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
						items: [{ item: track }]
					}
				})
			});
			return;
		}

		if (path.includes('/images/')) {
			coverRequests += 1;
			await route.fulfill({
				status: 200,
				contentType: 'image/svg+xml',
				body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640"><rect width="640" height="640" fill="#2563eb"/></svg>'
			});
			return;
		}

		await route.continue();
	});

	await page.goto(`/album/${album.id}`);
	await expect(page.locator(`img[alt="${album.title}"]`).first()).toBeVisible();

	await page.goto(`/artist/${artist.id}`);
	await expect(page.getByRole('heading', { name: artist.name })).toBeVisible();

	await page.goto(`/album/${album.id}`);
	await expect(page.locator(`img[alt="${album.title}"]`).first()).toBeVisible();
	expect(coverRequests).toBeGreaterThan(0);
});

test('download badge clears after queue drains', async ({ page }) => {
	let statsCalls = 0;

	await page.route('**/api/download-queue/stats', async (route) => {
		statsCalls += 1;
		const active = statsCalls < 4;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				success: true,
				queue: {
					queued: active ? 1 : 0,
					processing: 0,
					paused: 0,
					completed: active ? 0 : 1,
					failed: 0,
					total: active ? 1 : 1
				},
				worker: {
					running: true,
					activeDownloads: 0,
					maxConcurrent: 3
				},
				source: 'memory',
				localMode: true
			})
		});
	});

	await page.goto('/');
	const badge = page.locator('.download-manager-badge');
	await expect(badge).toHaveText('1');
	await expect(badge).toHaveCount(0, { timeout: 7000 });
});

test('download center supports pause and resume actions consistently', async ({ page }) => {
	let status: 'processing' | 'paused' | 'queued' = 'processing';

	const queueJob = () => ({
		id: 'job-1',
		status,
		progress: status === 'processing' ? 0.5 : 0,
		createdAt: Date.now() - 30_000,
		startedAt: Date.now() - 25_000,
		job: {
			type: 'album',
			albumId: 123,
			albumTitle: 'Queue Action Album',
			artistName: 'Queue Artist',
			quality: 'LOSSLESS'
		},
		trackCount: 10,
		completedTracks: status === 'processing' ? 5 : 0
	});

	await page.route('**/api/download-queue/stats', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				success: true,
				queue: {
					queued: status === 'queued' ? 1 : 0,
					processing: status === 'processing' ? 1 : 0,
					paused: status === 'paused' ? 1 : 0,
					completed: 0,
					failed: 0,
					total: 1
				},
				worker: {
					running: true,
					activeDownloads: status === 'processing' ? 1 : 0,
					maxConcurrent: 3
				},
				source: 'memory',
				localMode: true
			})
		});
	});

	await page.route('**/api/download-queue', async (route) => {
		if (route.request().method() !== 'GET') {
			await route.continue();
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				success: true,
				jobs: [queueJob()],
				source: 'memory'
			})
		});
	});

	await page.route('**/api/download-queue/job-1', async (route) => {
		if (route.request().method() !== 'PATCH') {
			await route.continue();
			return;
		}
		const payload = route.request().postDataJSON() as { action?: string };
		if (payload.action === 'pause') {
			status = 'paused';
		}
		if (payload.action === 'resume') {
			status = 'queued';
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ success: true })
		});
	});

	await page.goto('/');
	await page.getByTitle('Show download center').click();
	await expect(page.getByRole('heading', { name: 'Download Center' })).toBeVisible();

	await page.getByRole('button', { name: /Pause Active/i }).click();
	await expect(page.locator('.download-manager-notice')).toContainText('Paused');

	await page.getByRole('button', { name: /Resume Paused\/Failed/i }).click();
	await expect(page.locator('.download-manager-notice')).toContainText('Resumed');
});
