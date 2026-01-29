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
	streamStartDate: '2024-01-01',
	premiumStreamingOnly: false,
	replayGain: -6.5,
	peak: 0.95,
	artist: { id: 1, name: 'Session Artist', url: '', picture: '' },
	artists: [{ id: 1, name: 'Session Artist', url: '', picture: '' }],
	album: {
		id: 1,
		title: 'Session Album',
		cover: '',
		releaseDate: '2024-01-01',
		numberOfTracks: 10,
		numberOfVolumes: 1,
		duration: 1800
	}
});

test('sessions do not share persisted player state across tabs', async ({ context }) => {
	const track = buildTrack(777, 'Session Track');
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

	const page1 = await context.newPage();
	await page1.goto('/');
	await page1.waitForSelector('input[placeholder*="Search"]');
	await page1.evaluate((state) => {
		localStorage.setItem('tidal-ui:player', JSON.stringify(state));
	}, persisted);
	await page1.reload();
	await expect(page1.getByRole('heading', { name: /Session Track/i }).first()).toBeVisible();

	const page2 = await context.newPage();
	await page2.goto('/');
	await page2.waitForSelector('input[placeholder*="Search"]');
	await expect(page2.getByRole('heading', { name: /Session Track/i })).toHaveCount(0);
});
