import { describe, expect, it, vi } from 'vitest';

vi.mock('./trackConversionService', () => ({
	convertSonglinkTrackToTidal: () => 'converted',
	needsConversion: () => true
}));

vi.mock('./downloadService', () => ({
	downloadTrack: () => 'downloaded',
	buildDownloadFilename: () => 'filename'
}));

vi.mock('./playbackControlService', () => ({
	requestAudioPlayback: () => 'play',
	seekToPosition: () => 'seek',
	handlePreviousTrack: () => 'prev',
	setVolume: () => 'volume',
	toggleMute: () => 'mute'
}));

describe('playback services index', () => {
	it('re-exports playback services', async () => {
		const module = await import('./index');
		expect(module.convertSonglinkTrackToTidal()).toBe('converted');
		expect(module.needsConversion()).toBe(true);
		expect(module.downloadTrack()).toBe('downloaded');
		expect(module.buildDownloadFilename()).toBe('filename');
		expect(module.requestAudioPlayback()).toBe('play');
		expect(module.seekToPosition()).toBe('seek');
		expect(module.handlePreviousTrack()).toBe('prev');
		expect(module.setVolume()).toBe('volume');
		expect(module.toggleMute()).toBe('mute');
	});
});
