import { describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
	losslessAPI: { name: 'lossless' }
}));

vi.mock('./stores/player', () => ({
	playerStore: 'playerStore',
	currentTrack: 'currentTrack',
	isPlaying: 'isPlaying',
	currentTime: 'currentTime',
	duration: 'duration',
	volume: 'volume',
	progress: 'progress'
}));

vi.mock('./stores/downloadUi', () => ({
	downloadUiStore: 'downloadUiStore'
}));

vi.mock('./components/AudioPlayer.svelte', () => ({
	default: { name: 'AudioPlayer' }
}));

vi.mock('./components/SearchInterface.svelte', () => ({
	default: { name: 'SearchInterface' }
}));

vi.mock('./components/TrackList.svelte', () => ({
	default: { name: 'TrackList' }
}));

describe('lib exports', () => {
	it('re-exports API, stores, and components', async () => {
		const lib = await import('./index');
		expect(lib.tidalAPI).toEqual({ name: 'lossless' });
		expect(lib.playerStore).toBe('playerStore');
		expect(lib.downloadUiStore).toBe('downloadUiStore');
		expect(lib.AudioPlayer).toEqual({ name: 'AudioPlayer' });
		expect(lib.SearchInterface).toEqual({ name: 'SearchInterface' });
		expect(lib.TrackList).toEqual({ name: 'TrackList' });
	});
});
