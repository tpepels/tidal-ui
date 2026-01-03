/**
 * Playback Domain Services
 *
 * Centralized exports for all playback-related business logic.
 * These services handle playback operations independently of UI presentation.
 */

export {
	convertSonglinkTrackToTidal,
	needsConversion,
	type ConversionResult
} from './trackConversionService';

export {
	downloadTrack,
	buildDownloadFilename,
	type DownloadOptions,
	type DownloadResult,
	type DownloadError,
	type DownloadProgressEvent,
	type DownloadCallbacks
} from './downloadService';

export {
	requestAudioPlayback,
	seekToPosition,
	handlePreviousTrack,
	setVolume,
	toggleMute,
	handleExternalSeek
} from './playbackControlService';
