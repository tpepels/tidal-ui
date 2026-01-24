import type { AudioQuality } from '$lib/types';

export type AudioSupportResult = {
	supportsLosslessPlayback: boolean;
	streamingFallbackQuality: AudioQuality;
	flacSupported: boolean;
	aacSupported: boolean;
	mp3Supported: boolean;
};

export type CanPlayType = (type: string) => string;

type DetectAudioSupportOptions = {
	canPlayType?: CanPlayType | null;
	isFirefox?: boolean;
};

export const detectAudioSupport = (options: DetectAudioSupportOptions): AudioSupportResult => {
	const isFirefox = options.isFirefox ?? false;
	const canPlay = (type: string): boolean => {
		const support = options.canPlayType?.(type);
		return support === 'probably' || support === 'maybe';
	};

	const flacSupported =
		canPlay('audio/flac') ||
		canPlay('audio/x-flac') ||
		canPlay('audio/flac; codecs="flac"');
	const aacSupported =
		canPlay('audio/mp4; codecs="mp4a.40.2"') ||
		canPlay('audio/mp4') ||
		canPlay('audio/aac');
	const mp3Supported = canPlay('audio/mpeg');

	let streamingFallbackQuality: AudioQuality = aacSupported && !isFirefox ? 'HIGH' : 'LOW';
	if (!aacSupported && mp3Supported) {
		streamingFallbackQuality = 'LOW';
	}

	return {
		supportsLosslessPlayback: flacSupported && !isFirefox,
		streamingFallbackQuality,
		flacSupported,
		aacSupported,
		mp3Supported
	};
};
