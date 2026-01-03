/**
 * Download Orchestrator
 *
 * Coordinates track downloads with automatic Songlink-to-TIDAL conversion,
 * UI state management, and retry handling. Acts as a bridge between components
 * and the download/conversion services.
 */

import type { PlayableTrack, Track, AudioQuality } from '$lib/types';
import { isSonglinkTrack } from '$lib/types';
import {
	buildDownloadFilename,
	type DownloadError
} from '$lib/services/playback/downloadService';
import { convertSonglinkTrackToTidal } from '$lib/services/playback/trackConversionService';
import type { TrackConversionError } from '$lib/services/playback/trackConversionService';
import { losslessAPI, type TrackDownloadProgress } from '$lib/api';
import { downloadUiStore } from '$lib/stores/downloadUi';
import { userPreferencesStore } from '$lib/stores/userPreferences';
import { toasts } from '$lib/stores/toasts';
import { get } from 'svelte/store';

/**
 * Download orchestration options
 */
export interface DownloadOrchestratorOptions {
	/** Audio quality for download */
	quality?: AudioQuality;

	/** Whether to convert AAC files to MP3 */
	convertAacToMp3?: boolean;

	/** Whether to download cover art separately */
	downloadCoversSeperately?: boolean;

	/** Whether to attempt auto-conversion of Songlink tracks */
	autoConvertSonglink?: boolean;

	/** Notification mode: 'alert' shows alerts, 'toast' shows toasts, 'silent' shows nothing */
	notificationMode?: 'alert' | 'toast' | 'silent';

	/** Optional subtitle override for the download task */
	subtitle?: string;

	/** AbortSignal for cancellation */
	signal?: AbortSignal;

	/** Whether ffmpeg conversion was auto-triggered */
	ffmpegAutoTriggered?: boolean;

	/** Whether to skip the ffmpeg countdown UI */
	skipFfmpegCountdown?: boolean;
}

/**
 * Structured result from download orchestration
 */
export type DownloadOrchestratorResult =
	| { success: true; filename: string; taskId: string }
	| { success: false; error: DownloadOrchestratorError; taskId?: string };

/**
 * Unified error type combining conversion and download errors
 */
export type DownloadOrchestratorError =
	| { code: 'SONGLINK_NOT_SUPPORTED'; retry: false; message: string; canConvert: true }
	| { code: 'CONVERSION_FAILED'; retry: false; message: string; conversionError: TrackConversionError }
	| DownloadError;

/**
 * Stored download attempt for retry functionality
 */
interface DownloadAttempt {
	track: PlayableTrack;
	options: DownloadOrchestratorOptions;
	timestamp: number;
}

/**
 * Download Orchestrator Class
 * Manages download lifecycle with automatic conversion and state tracking
 */
export class DownloadOrchestrator {
	/** Map of taskId -> download attempt for retry functionality */
	private downloadAttempts = new Map<string, DownloadAttempt>();

	/** Maximum number of stored attempts (prevents memory leak) */
	private readonly MAX_STORED_ATTEMPTS = 50;

	/**
	 * Initiates a track download with automatic Songlink conversion if needed
	 *
	 * @param track - Track to download (can be Track or SonglinkTrack)
	 * @param options - Download options including quality, conversion preferences
	 * @returns Promise resolving to structured result with taskId for tracking
	 */
	async downloadTrack(
		track: PlayableTrack,
		options?: DownloadOrchestratorOptions
	): Promise<DownloadOrchestratorResult> {
		const effectiveOptions = this.resolveOptions(options);
		let targetTrack: Track;

		// Step 1: Handle Songlink conversion if needed
		if (isSonglinkTrack(track)) {
			if (!effectiveOptions.autoConvertSonglink) {
				return {
					success: false,
					error: {
						code: 'SONGLINK_NOT_SUPPORTED',
						retry: false,
						message:
							'Songlink tracks must be converted to TIDAL first. Enable auto-conversion or convert manually.',
						canConvert: true
					}
				};
			}

			// Attempt automatic conversion
			const conversionResult = await convertSonglinkTrackToTidal(track);

			if (!conversionResult.success || !conversionResult.track) {
				this.showNotification(
					'error',
					`Failed to convert track: ${conversionResult.error?.message || 'Unknown error'}`,
					effectiveOptions.notificationMode
				);

				return {
					success: false,
					error: {
						code: 'CONVERSION_FAILED',
						retry: false,
						message: `Auto-conversion failed: ${conversionResult.error?.message || 'Unknown error'}`,
						conversionError: conversionResult.error!
					}
				};
			}

			targetTrack = conversionResult.track;

			this.showNotification(
				'success',
				`Converted "${track.title}" to TIDAL`,
				effectiveOptions.notificationMode
			);
		} else {
			targetTrack = track;
		}

		// Step 2: Build filename
		const filename = buildDownloadFilename(
			targetTrack,
			effectiveOptions.quality,
			effectiveOptions.convertAacToMp3
		);

		// Step 3: Initialize download task in UI store
		const { taskId, controller } = downloadUiStore.beginTrackDownload(
			targetTrack,
			filename,
			{ subtitle: effectiveOptions.subtitle }
		);

		// Store attempt for potential retry
		this.storeAttempt(taskId, track, effectiveOptions);

		// Optionally skip ffmpeg countdown
		if (effectiveOptions.skipFfmpegCountdown) {
			downloadUiStore.skipFfmpegCountdown();
		}

		// Step 4: Execute download via API with all callbacks wired to store
		try {
			await losslessAPI.downloadTrack(targetTrack.id, effectiveOptions.quality, filename, {
				signal: effectiveOptions.signal ?? controller.signal,
				convertAacToMp3: effectiveOptions.convertAacToMp3,
				downloadCoverSeperately: effectiveOptions.downloadCoversSeperately,
				ffmpegAutoTriggered: effectiveOptions.ffmpegAutoTriggered ?? false,
				onProgress: (progress: TrackDownloadProgress) => {
					if (progress.stage === 'downloading') {
						downloadUiStore.updateTrackProgress(taskId!, progress.receivedBytes, progress.totalBytes);
					} else if (progress.stage === 'embedding') {
						downloadUiStore.updateTrackStage(taskId!, progress.progress);
					}
				},
				onFfmpegCountdown: ({ totalBytes, autoTriggered }) => {
					if (typeof totalBytes === 'number') {
						downloadUiStore.startFfmpegCountdown(totalBytes, { autoTriggered });
					} else {
						downloadUiStore.startFfmpegCountdown(0, { autoTriggered });
					}
				},
				onFfmpegStart: () => {
					downloadUiStore.startFfmpegLoading();
				},
				onFfmpegProgress: (progress: number) => {
					downloadUiStore.updateFfmpegProgress(progress);
				},
				onFfmpegComplete: () => {
					downloadUiStore.completeFfmpeg();
				},
				onFfmpegError: (error: unknown) => {
					const message = error instanceof Error ? error.message : 'FFmpeg conversion failed';
					downloadUiStore.errorFfmpeg(message);
				}
			});

			// Download completed successfully
			downloadUiStore.completeTrackDownload(taskId!);
			this.showNotification('success', `Downloaded: ${filename}`, effectiveOptions.notificationMode);

			return { success: true, filename, taskId };
		} catch (error) {
			// Handle cancellation vs errors
			if (error instanceof DOMException && error.name === 'AbortError') {
				downloadUiStore.completeTrackDownload(taskId!);
				return {
					success: false,
					error: {
						code: 'DOWNLOAD_CANCELLED',
						retry: false,
						message: 'Download was cancelled'
					},
					taskId
				};
			}

			// Handle other errors
			const errorMessage = error instanceof Error ? error.message : 'Unexpected download error';
			downloadUiStore.errorTrackDownload(taskId, errorMessage);
			this.showNotification('error', errorMessage, effectiveOptions.notificationMode);

			return {
				success: false,
				error: {
					code: 'UNKNOWN_ERROR',
					retry: false,
					message: errorMessage,
					originalError: error
				},
				taskId
			};
		}
	}

	/**
	 * Retries a previously failed download using stored options
	 *
	 * @param taskId - Task ID from the original download attempt
	 * @returns Promise resolving to new download result (with new taskId)
	 */
	async retryDownload(taskId: string): Promise<DownloadOrchestratorResult> {
		const attempt = this.downloadAttempts.get(taskId);

		if (!attempt) {
			return {
				success: false,
				error: {
					code: 'UNKNOWN_ERROR',
					retry: false,
					message:
						'Cannot retry: Original download attempt not found. This may happen if too much time has passed.'
				}
			};
		}

		// Use stored track and options from original attempt
		return this.downloadTrack(attempt.track, attempt.options);
	}

	/**
	 * Cancels an in-progress download
	 *
	 * @param taskId - Task ID to cancel
	 */
	cancelDownload(taskId: string): void {
		downloadUiStore.cancelTrackDownload(taskId);
	}

	/**
	 * Clears stored download attempts (useful for cleanup)
	 */
	clearAttempts(): void {
		this.downloadAttempts.clear();
	}

	// === PRIVATE HELPERS ===

	private resolveOptions(
		options?: DownloadOrchestratorOptions
	): Required<Omit<DownloadOrchestratorOptions, 'signal'>> & Pick<DownloadOrchestratorOptions, 'signal'> {
		const prefs = get(userPreferencesStore);

		return {
			quality: options?.quality ?? 'LOSSLESS',
			convertAacToMp3: options?.convertAacToMp3 ?? prefs.convertAacToMp3,
			downloadCoversSeperately: options?.downloadCoversSeperately ?? prefs.downloadCoversSeperately,
			autoConvertSonglink: options?.autoConvertSonglink ?? true,
			notificationMode: options?.notificationMode ?? 'alert',
			subtitle: options?.subtitle ?? '',
			ffmpegAutoTriggered: options?.ffmpegAutoTriggered ?? false,
			skipFfmpegCountdown: options?.skipFfmpegCountdown ?? false,
			signal: options?.signal
		};
	}

	private storeAttempt(
		taskId: string,
		track: PlayableTrack,
		options: DownloadOrchestratorOptions
	): void {
		this.downloadAttempts.set(taskId, {
			track,
			options,
			timestamp: Date.now()
		});

		// Prune old attempts if we exceed the limit
		if (this.downloadAttempts.size > this.MAX_STORED_ATTEMPTS) {
			const entries = Array.from(this.downloadAttempts.entries());
			entries.sort((a, b) => a[1].timestamp - b[1].timestamp);

			// Remove oldest 25%
			const toRemove = Math.floor(this.MAX_STORED_ATTEMPTS * 0.25);
			for (let i = 0; i < toRemove; i++) {
				this.downloadAttempts.delete(entries[i][0]);
			}
		}
	}

	private showNotification(
		type: 'success' | 'error',
		message: string,
		mode: 'alert' | 'toast' | 'silent'
	): void {
		switch (mode) {
			case 'alert':
				if (type === 'error') {
					alert(message);
				}
				break;
			case 'toast':
				toasts[type](message);
				break;
			case 'silent':
				// No notification
				break;
		}
	}
}

// Export singleton instance
export const downloadOrchestrator = new DownloadOrchestrator();
