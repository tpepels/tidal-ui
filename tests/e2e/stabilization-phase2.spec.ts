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

test('search race prefers the most recent query', async ({ page }) => {
	await page.route('**/api/proxy**', async (route) => {
		const requestUrl = new URL(route.request().url());
		const proxiedUrl = requestUrl.searchParams.get('url');
		if (!proxiedUrl) {
			await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
			return;
		}
		const decoded = new URL(proxiedUrl);
		const query = decoded.searchParams.get('s');
		if (!query) {
			await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) });
			return;
		}

		if (query === 'first') {
			await new Promise((resolve) => setTimeout(resolve, 200));
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ items: [buildTrack(101, 'First Track')] })
			});
			return;
		}

		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ items: [buildTrack(202, 'Second Track')] })
		});
	});

	await page.goto('/');
	const searchInput = page.locator('input[placeholder*="Search"]');
	await searchInput.fill('first');
	await searchInput.press('Enter');
	await searchInput.fill('second');
	const waitForSecond = page.waitForResponse((response) => {
		if (!response.url().includes('/api/proxy')) {
			return false;
		}
		try {
			const responseUrl = new URL(response.url());
			const proxied = responseUrl.searchParams.get('url');
			if (!proxied) {
				return false;
			}
			const decoded = new URL(proxied);
			return decoded.searchParams.get('s') === 'second';
		} catch {
			return false;
		}
	});
	await searchInput.press('Enter');
	await waitForSecond;

	const secondTrack = page.getByRole('button', { name: /Second Track/ }).first();
	await expect(secondTrack).toBeVisible();
	await expect(page.locator('text=First Track')).toHaveCount(0);
});
