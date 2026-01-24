import { describe, expect, it } from 'vitest';
import { detectAudioSupport } from './audioSupport';

const createCanPlayType = (supported: Record<string, string>) => (type: string) =>
	supported[type] ?? '';

describe('detectAudioSupport', () => {
	it('detects lossless support and high streaming fallback on non-Firefox browsers', () => {
		const canPlayType = createCanPlayType({
			'audio/flac': 'probably',
			'audio/mp4': 'maybe'
		});
		const result = detectAudioSupport({ canPlayType, isFirefox: false });

		expect(result.supportsLosslessPlayback).toBe(true);
		expect(result.streamingFallbackQuality).toBe('HIGH');
		expect(result.flacSupported).toBe(true);
		expect(result.aacSupported).toBe(true);
	});

	it('disables lossless on Firefox even when FLAC is reported', () => {
		const canPlayType = createCanPlayType({
			'audio/flac; codecs="flac"': 'probably',
			'audio/mp4': 'probably'
		});
		const result = detectAudioSupport({ canPlayType, isFirefox: true });

		expect(result.supportsLosslessPlayback).toBe(false);
		expect(result.streamingFallbackQuality).toBe('LOW');
	});

	it('falls back to low quality when only MP3 is supported', () => {
		const canPlayType = createCanPlayType({
			'audio/mpeg': 'probably'
		});
		const result = detectAudioSupport({ canPlayType, isFirefox: false });

		expect(result.supportsLosslessPlayback).toBe(false);
		expect(result.streamingFallbackQuality).toBe('LOW');
		expect(result.mp3Supported).toBe(true);
	});
});
