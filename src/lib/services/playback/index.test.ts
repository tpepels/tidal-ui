import { describe, expect, it, vi } from 'vitest';
import type { SonglinkTrack, Track } from '$lib/types';
import type { ConversionResult } from './trackConversionService';
import type { DownloadResult } from './downloadService';
import type { AudioQuality } from '$lib/types';

vi.mock('./trackConversionService', () => ({
	convertSonglinkTrackToTidal: async () => ({ success: true }) as ConversionResult,
	needsConversion: () => true
}));

vi.mock('./downloadService', () => ({
	downloadTrack: async () => ({ success: true, filename: 'filename' }) as DownloadResult,
	buildDownloadFilename: () => 'filename'
}));

vi.mock('./playbackControlService', () => ({
	requestAudioPlayback: async () => undefined,
	seekToPosition: () => undefined,
	handlePreviousTrack: () => undefined,
	setVolume: () => 1,
	toggleMute: () => ({ isMuted: true, volume: 0, previousVolume: 1 })
}));

describe('playback services index', () => {
	it('re-exports playback services', async () => {
		const module = await import('./index');
		const mockSonglinkTrack: SonglinkTrack = {
			id: 'spotify:track:sl-123',
			title: 'Test Songlink Track',
			artistName: 'Test Artist',
			duration: 180,
			thumbnailUrl: 'https://example.com/image.jpg',
			sourceUrl: 'https://open.spotify.com/track/sl-123',
			songlinkData: {
				entityUniqueId: 'sl-123',
				userCountry: 'US',
				pageUrl: 'https://song.link/sl-123',
				entitiesByUniqueId: {},
				linksByPlatform: {}
			},
			isSonglinkTrack: true,
			audioQuality: 'LOSSLESS'
		};
		const mockTrack: Track = {
			id: 1,
			title: 'Test Track',
			duration: 200,
			version: null,
			popularity: 0,
			editable: false,
			explicit: false,
			trackNumber: 1,
			volumeNumber: 1,
			isrc: 'TEST',
			url: 'https://example.com',
			audioQuality: 'LOSSLESS',
			audioModes: ['STEREO'],
			allowStreaming: true,
			streamReady: true,
			premiumStreamingOnly: false,
			artist: { id: 1, name: 'Test Artist', type: 'MAIN' },
			artists: [{ id: 1, name: 'Test Artist', type: 'MAIN' }],
			album: { id: 1, title: 'Test Album', cover: '', videoCover: null }
		};
		const mockAudio = {} as HTMLAudioElement;

		const conversion = await module.convertSonglinkTrackToTidal(mockSonglinkTrack);
		expect(conversion).toEqual({ success: true });
		expect(module.needsConversion(mockSonglinkTrack)).toBe(true);

		const download = await module.downloadTrack(mockTrack);
		expect(download).toEqual({ success: true, filename: 'filename' });
		expect(module.buildDownloadFilename(mockTrack, 'LOSSLESS' as AudioQuality)).toBe('filename');

		await expect(module.requestAudioPlayback(mockAudio)).resolves.toBeUndefined();
		expect(module.seekToPosition(mockAudio, 0, { duration: 120 })).toBeUndefined();
		expect(
			module.handlePreviousTrack(mockAudio, {
				currentTime: 0,
				queueIndex: 0
			})
		).toBeUndefined();
		expect(module.setVolume(0.5)).toBe(1);
		expect(module.toggleMute(0.5, false)).toEqual({
			isMuted: true,
			volume: 0,
			previousVolume: 1
		});
	});
});
