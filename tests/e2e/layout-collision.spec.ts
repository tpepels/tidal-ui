import { expect, test, type Locator, type Page } from '@playwright/test';

type QueueMode = 'idle' | 'active';

type Box = {
	top: number;
	right: number;
	bottom: number;
	left: number;
	width: number;
	height: number;
};

const SILENT_AUDIO_DATA_URL =
	'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=';

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
	numberOfTracks: 8,
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
	album: ReturnType<typeof buildAlbum>,
	trackNumber: number
) => ({
	id,
	title,
	duration: 180,
	trackNumber,
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

const buildQueueDashboardPayload = (queueMode: QueueMode) => {
	if (queueMode === 'idle') {
		return {
			success: true,
			jobs: [],
			queue: {
				queued: 0,
				processing: 0,
				paused: 0,
				completed: 0,
				failed: 0,
				total: 0
			},
			metrics: {
				total_jobs: 0,
				queued: 0,
				processing: 0,
				paused: 0,
				completed: 0,
				failed: 0,
				cancelled: 0,
				avg_success_rate: 100,
				avg_retry_count: 0,
				total_download_time_ms: 0,
				avg_job_duration_ms: 0,
				failure_by_code: {}
			},
			worker: {
				running: true,
				activeDownloads: 0,
				maxConcurrent: 4
			},
			queueSource: 'memory',
			localMode: false
		};
	}

	return {
		success: true,
		jobs: [
			{
				id: 'job-1',
				status: 'processing',
				progress: 0.42,
				createdAt: Date.now() - 120_000,
				startedAt: Date.now() - 90_000,
				lastUpdatedAt: Date.now() - 2_000,
				trackCount: 8,
				completedTracks: 3,
				job: {
					type: 'album',
					albumId: 201,
					albumTitle: 'Collision Album',
					artistName: 'Collision Artist',
					quality: 'LOSSLESS'
				}
			}
		],
		queue: {
			queued: 1,
			processing: 1,
			paused: 0,
			completed: 0,
			failed: 0,
			total: 2
		},
		metrics: {
			total_jobs: 2,
			queued: 1,
			processing: 1,
			paused: 0,
			completed: 0,
			failed: 0,
			cancelled: 0,
			avg_success_rate: 100,
			avg_retry_count: 0,
			total_download_time_ms: 90_000,
			avg_job_duration_ms: 45_000,
			failure_by_code: {}
		},
		worker: {
			running: true,
			activeDownloads: 1,
			maxConcurrent: 4
		},
		queueSource: 'memory',
		localMode: false
	};
};

async function installMediaStubs(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const originalPause = HTMLMediaElement.prototype.pause;
		const originalCanPlayType = HTMLMediaElement.prototype.canPlayType;

		HTMLMediaElement.prototype.load = function () {
			window.setTimeout(() => {
				try {
					Object.defineProperty(this, 'duration', {
						configurable: true,
						value: 180
					});
				} catch {
					// ignore
				}
				this.dispatchEvent(new Event('loadedmetadata'));
				this.dispatchEvent(new Event('durationchange'));
				this.dispatchEvent(new Event('loadeddata'));
			}, 0);
		};

		HTMLMediaElement.prototype.play = function () {
			window.setTimeout(() => {
				this.dispatchEvent(new Event('playing'));
			}, 0);
			return Promise.resolve();
		};

		HTMLMediaElement.prototype.pause = function () {
			window.setTimeout(() => {
				this.dispatchEvent(new Event('pause'));
			}, 0);
			return originalPause.apply(this);
		};

		HTMLMediaElement.prototype.canPlayType = function (type: string) {
			if (type.includes('audio/')) {
				return 'probably';
			}
			return originalCanPlayType.apply(this, [type]);
		};
	});
}

async function installAppMockRoutes(page: Page, queueMode: QueueMode = 'idle'): Promise<void> {
	const artist = buildArtist(101, 'Collision Artist');
	const album = buildAlbum(201, 'Collision Album', artist);
	const tracks = Array.from({ length: 8 }, (_, index) =>
		buildTrack(301 + index, `Collision Track ${index + 1}`, artist, album, index + 1)
	);
	const trackById = new Map(tracks.map((track) => [track.id, track]));
	const queuePayload = buildQueueDashboardPayload(queueMode);

	await page.route('**/api/artwork/**', async (route) => {
		await route.fulfill({ status: 204, body: '' });
	});

	await page.route('**/api/catalog/album/**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				album,
				tracks
			})
		});
	});

	await page.route('**/api/catalog/track/**', async (route) => {
		const url = new URL(route.request().url());
		const match = url.pathname.match(/\/api\/catalog\/track\/(\d+)/);
		const trackId = Number.parseInt(match?.[1] ?? '0', 10);
		const track = trackById.get(trackId) ?? tracks[0];
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				track,
				info: {
					trackId: track.id,
					audioQuality: 'LOSSLESS',
					audioMode: 'STEREO',
					sampleRate: 44100,
					bitDepth: 16,
					manifest: '',
					manifestMimeType: 'application/json',
					assetPresentation: 'FULL'
				}
			})
		});
	});

	await page.route('**/api/playback/track/*/stream**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				url: SILENT_AUDIO_DATA_URL,
				replayGain: -6.5,
				sampleRate: 44100,
				bitDepth: 16
			})
		});
	});

	await page.route('**/api/download-queue/dashboard', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(queuePayload)
		});
	});

	await page.route('**/api/cache/clear', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				cleared: {
					officialMemoryCleared: 1,
					officialRedisCleared: 0,
					proxyRedisCleared: 0
				}
			})
		});
	});

	await page.route('**/api/metadata/musicbrainz', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				lookupStatus: 'no_match',
				tags: {}
			})
		});
	});

	await page.route('**/api/metadata/musicbrainz-release-search', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ releases: [] })
		});
	});

	await page.route('**/api/metadata/musicbrainz-artist-search', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ artists: [] })
		});
	});
}

async function playAlbum(page: Page): Promise<void> {
	await page.goto('/album/201');
	const playAlbumButton = page.getByRole('button', { name: /^Play album$/ });
	await expect(playAlbumButton).toBeVisible();
	await playAlbumButton.click();
	await expect(page.locator('[data-floating-surface="player"]')).toBeVisible();
}

async function getBox(locator: Locator): Promise<Box> {
	await expect(locator).toBeVisible();
	const rawBox = await locator.boundingBox();
	expect(rawBox).not.toBeNull();
	const box = rawBox as NonNullable<typeof rawBox>;
	return {
		top: box.y,
		right: box.x + box.width,
		bottom: box.y + box.height,
		left: box.x,
		width: box.width,
		height: box.height
	};
}

function boxesOverlap(a: Box, b: Box, tolerance = 1): boolean {
	return !(
		a.right <= b.left + tolerance ||
		a.left >= b.right - tolerance ||
		a.bottom <= b.top + tolerance ||
		a.top >= b.bottom - tolerance
	);
}

async function expectNoOverlap(a: Locator, b: Locator, label: string): Promise<void> {
	const aBox = await getBox(a);
	const bBox = await getBox(b);
	expect(boxesOverlap(aBox, bBox), label).toBe(false);
}

async function getZIndex(page: Page, selector: string): Promise<number> {
	return Number.parseInt(
		await page.locator(selector).evaluate((node) => getComputedStyle(node).zIndex || '0'),
		10
	);
}

test.describe('layout collision hardening', () => {
	test('mobile shell keeps top stack, toast rail, and player separated', async ({ page }) => {
		await installMediaStubs(page);
		await installAppMockRoutes(page, 'idle');
		await page.setViewportSize({ width: 390, height: 844 });

		await playAlbum(page);
		const mobileNav = page.locator('.mobile-primary-nav');
		await expect(mobileNav).toBeVisible();
		await mobileNav.getByRole('link', { name: 'Settings' }).click();
		await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();

		const clearCacheButton = page.getByRole('button', { name: /Clear app cache/i });
		await clearCacheButton.scrollIntoViewIfNeeded();
		await clearCacheButton.click();

		const topbar = page.locator('.mobile-topbar');
		const primaryNav = page.locator('.mobile-primary-nav');
		const toast = page.locator('.toast-container .toast').first();
		const player = page.locator('[data-floating-surface="player"]');

		await expect(toast).toBeVisible();
		await expectNoOverlap(topbar, primaryNav, 'mobile topbar and primary nav must not overlap');
		await expectNoOverlap(
			primaryNav,
			toast,
			'mobile toasts must sit below the top stack without covering it'
		);
		await expectNoOverlap(
			toast,
			player,
			'mobile toast rail must not collide with the player surface'
		);
	});

	test('tight and regular desktop detail routes separate sticky nav, utilities, and dialogs', async ({
		page
	}) => {
		await installMediaStubs(page);
		await installAppMockRoutes(page, 'active');

		for (const viewport of [
			{ width: 768, height: 600, sectionPosition: 'static' },
			{ width: 1280, height: 720, sectionPosition: 'static' },
			{ width: 1600, height: 1200, sectionPosition: 'sticky' }
		]) {
			await page.setViewportSize({ width: viewport.width, height: viewport.height });
			await playAlbum(page);

			const sectionNav = page.locator('.ui-section-nav').first();
			await expect(sectionNav).toBeVisible();
			expect(
				await sectionNav.evaluate((node) => getComputedStyle(node).position)
			).toBe(viewport.sectionPosition);

			const player = page.locator('[data-floating-surface="player"]');
			const summary = page.locator('[data-floating-surface="download-summary"]');
			await expect(summary).toBeVisible();
			await expectNoOverlap(
				summary,
				player,
				`download summary and player must not overlap at ${viewport.width}x${viewport.height}`
			);

			await summary.click();
			const panel = page.locator('[data-floating-surface="download-panel"]');
			await expect(panel).toBeVisible();
			await expectNoOverlap(
				panel,
				player,
				`download panel and player must not overlap at ${viewport.width}x${viewport.height}`
			);

			const queueToggle = page.getByRole('button', { name: /Toggle queue panel/i });
			await queueToggle.click();
			const clearQueueButton = page.getByRole('button', { name: /^Clear queue$/i });
			await expect(clearQueueButton).toBeVisible();
			await clearQueueButton.click();

			const dialogLayer = page.locator('.ui-dialog-layer');
			const dialog = dialogLayer.locator('[role="dialog"]');
			await expect(dialog).toBeVisible();

			const dialogZ = await getZIndex(page, '.ui-dialog-layer');
			const panelZ = await getZIndex(page, '[data-floating-surface="download-panel"]');
			const playerZ = await getZIndex(page, '[data-floating-surface="player"]');
			expect(dialogZ).toBeGreaterThan(panelZ);
			expect(dialogZ).toBeGreaterThan(playerZ);

			await page.getByRole('button', { name: /Keep queue/i }).click();
			await expect(dialog).toBeHidden();
		}
	});

	test('embed routes keep footer chrome in flow on narrow and short frames', async ({ page }) => {
		await installMediaStubs(page);
		await installAppMockRoutes(page, 'idle');

		for (const viewport of [
			{ width: 320, height: 568 },
			{ width: 768, height: 450 }
		]) {
			await page.setViewportSize(viewport);
			await page.goto('/embed/album/201');

			const heroAction = page.locator('.open-link');
			await expect(heroAction).toBeVisible();

			await page.locator('.cover-art .play-button').click();
			const footer = page.locator('[data-embed-footer="now-playing"]');
			await expect(footer).toBeVisible();
			await expectNoOverlap(
				heroAction,
				footer,
				`embed footer must not cover hero actions at ${viewport.width}x${viewport.height}`
			);

			const lastTrack = page.locator('.track-item').last();
			await lastTrack.scrollIntoViewIfNeeded();
			await expect(lastTrack).toBeVisible();
			await expectNoOverlap(
				lastTrack,
				footer,
				`embed footer must not cover track rows at ${viewport.width}x${viewport.height}`
			);
		}
	});
});
