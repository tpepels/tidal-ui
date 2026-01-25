/**
 * Download Orchestrator
 *
 * Coordinates track downloads with automatic Songlink-to-TIDAL conversion,
 * UI state management, and retry handling. Acts as a bridge between components
 * and the download/conversion services.
 */

import type { PlayableTrack, AudioQuality } from '$lib/types';
import {
	buildDownloadFilename,
	type DownloadError
} from '$lib/services/playback/downloadService';
import { downloadPreferencesStore, type DownloadStorage } from '$lib/stores/downloadPreferences';
import { userPreferencesStore } from '$lib/stores/userPreferences';
import { resolveDownloadOptions } from './download/resolveDownloadOptions';
import { mapDownloadError, type MappedDownloadError } from '$lib/downloadErrorMapper';
import { createDownloadUiPort, type DownloadUiPort } from './download/downloadUiPort';
import {
	createDownloadExecutionPort,
	type DownloadExecutionPort
} from './download/downloadExecutionPort';
import { createTrackResolver, type TrackResolutionError, type TrackResolver } from './download/trackResolver';
import { createDownloadExecutors } from './download/executors';
import { createProgressTracker } from './download/progressTracker';
import { createDownloadLogPort, type DownloadLogPort } from './download/downloadLogPort';
import {
	createDownloadNotificationPort,
	type DownloadNotificationPort
} from './download/downloadNotificationPort';
import { get } from 'svelte/store';

const isMappedDownloadError = (value: unknown): value is MappedDownloadError =>
	typeof value === 'object' &&
	value !== null &&
	'code' in value &&
	'retry' in value &&
	'userMessage' in value;

export interface DownloadOrchestratorDeps {
	ui?: DownloadUiPort;
	log?: DownloadLogPort;
	notifier?: DownloadNotificationPort;
	trackResolver?: TrackResolver;
	execution?: DownloadExecutionPort;
}

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

	/** Whether to use the download coordinator path */
	useCoordinator?: boolean;

	/** Storage target for download */
	storage?: DownloadStorage;

	/** Conflict resolution strategy for server downloads */
	conflictResolution?: 'overwrite' | 'skip' | 'rename' | 'overwrite_if_different';
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
	| TrackResolutionError
	| { code: 'SERVER_ERROR'; retry: true; message: string; originalError?: unknown }
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
	private readonly ui: DownloadUiPort;
	private readonly log: DownloadLogPort;
	private readonly notifier: DownloadNotificationPort;
	private readonly trackResolver: TrackResolver;
	private readonly execution: DownloadExecutionPort;
	private readonly executors: ReturnType<typeof createDownloadExecutors>;

	constructor(deps?: DownloadOrchestratorDeps) {
		this.ui = deps?.ui ?? createDownloadUiPort();
		this.log = deps?.log ?? createDownloadLogPort();
		this.notifier = deps?.notifier ?? createDownloadNotificationPort();
		this.trackResolver = deps?.trackResolver ?? createTrackResolver();
		this.execution = deps?.execution ?? createDownloadExecutionPort();
		this.executors = createDownloadExecutors(this.execution);
	}

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
		const effectiveConvertAacToMp3 =
			effectiveOptions.storage === 'client' ? effectiveOptions.convertAacToMp3 : false;

		// Step 1: Handle Songlink conversion if needed
		const resolutionResult = await this.trackResolver.resolve(track, {
			autoConvertSonglink: effectiveOptions.autoConvertSonglink
		});

		if (!resolutionResult.success) {
			if (resolutionResult.error.code === 'CONVERSION_FAILED') {
				this.showNotification(
					'error',
					`Failed to convert track: ${
						resolutionResult.error.conversionError?.message || 'Unknown error'
					}`,
					effectiveOptions.notificationMode
				);
			}

			return {
				success: false,
				error: resolutionResult.error
			};
		}

		const targetTrack = resolutionResult.track;

		if (resolutionResult.converted) {
			this.showNotification(
				'success',
				`Converted "${track.title}" to TIDAL`,
				effectiveOptions.notificationMode
			);
		}

		// Step 2: Build filename
		const filename = buildDownloadFilename(
			targetTrack,
			effectiveOptions.quality,
			effectiveConvertAacToMp3
		);

		// Step 3: Initialize download task in UI store
		const { taskId, controller } = this.ui.beginTrackDownload(
			targetTrack,
			filename,
			{
				subtitle: effectiveOptions.subtitle,
				storage: effectiveOptions.storage
			}
		);

		// Store attempt for potential retry
		this.storeAttempt(taskId, track, effectiveOptions);

		// Optionally skip ffmpeg countdown
		if (effectiveOptions.skipFfmpegCountdown) {
			this.ui.skipFfmpegCountdown();
		}

		// Step 4: Execute download via API with all callbacks wired to store
		try {
			const progressTracker = createProgressTracker({
				taskId: taskId!,
				storage: effectiveOptions.storage,
				ui: this.ui
			});

			if (effectiveOptions.useCoordinator) {
				const isServer = effectiveOptions.storage === 'server';
				const coordinatorResult = await this.executors.coordinator.execute({
					track: targetTrack,
					quality: effectiveOptions.quality,
					filename,
					storage: effectiveOptions.storage,
					convertAacToMp3: effectiveConvertAacToMp3,
					downloadCoverSeperately: effectiveOptions.downloadCoversSeperately,
					conflictResolution: effectiveOptions.conflictResolution,
					signal: effectiveOptions.signal ?? controller.signal,
					onProgress: progressTracker
				});

				if (!coordinatorResult.success) {
					const mappedError = mapDownloadError(coordinatorResult.error ?? 'Download failed');
					if (isServer) {
						this.log.error(`Server download failed: ${mappedError.message}`);
					}
					throw mappedError;
				}

				if (isServer) {
					this.log.success(
						coordinatorResult.message
							? `Server download complete: ${coordinatorResult.message}`
							: 'Server download complete'
					);
				}
			} else if (effectiveOptions.storage === 'server') {
				const serverResult = await this.executors.server.execute({
					track: targetTrack,
					quality: effectiveOptions.quality,
					filename,
					storage: effectiveOptions.storage,
					convertAacToMp3: effectiveConvertAacToMp3,
					downloadCoverSeperately: effectiveOptions.downloadCoversSeperately,
					conflictResolution: effectiveOptions.conflictResolution,
					signal: effectiveOptions.signal ?? controller.signal,
					onProgress: progressTracker
				});

				if (!serverResult.success) {
					const errorMessage = serverResult.error ?? 'Server download failed';
					this.ui.errorTrackDownload(taskId, errorMessage);
					this.log.error(`Server download failed: ${errorMessage}`);
					throw new Error(errorMessage);
				}

				this.log.success(
					serverResult.message ? `Server download complete: ${serverResult.message}` : 'Server download complete'
				);
			} else {
				await this.executors.client.execute({
					track: targetTrack,
					quality: effectiveOptions.quality,
					filename,
					storage: effectiveOptions.storage,
					convertAacToMp3: effectiveConvertAacToMp3,
					downloadCoverSeperately: effectiveOptions.downloadCoversSeperately,
					signal: effectiveOptions.signal ?? controller.signal,
					ffmpegAutoTriggered: effectiveOptions.ffmpegAutoTriggered ?? false,
					onProgress: progressTracker,
					onFfmpegCountdown: ({ totalBytes, autoTriggered }) => {
						if (typeof totalBytes === 'number') {
							this.ui.startFfmpegCountdown(totalBytes, { autoTriggered });
						} else {
							this.ui.startFfmpegCountdown(0, { autoTriggered });
						}
					},
					onFfmpegStart: () => {
						this.ui.startFfmpegLoading();
					},
					onFfmpegProgress: (progress: number) => {
						this.ui.updateFfmpegProgress(progress);
					},
					onFfmpegComplete: () => {
						this.ui.completeFfmpeg();
					},
					onFfmpegError: (error: unknown) => {
						const message = error instanceof Error ? error.message : 'FFmpeg conversion failed';
						this.ui.errorFfmpeg(message);
					}
				});
			}

			// Download completed successfully
			this.ui.completeTrackDownload(taskId!);
			const successMessage =
				effectiveOptions.storage === 'server'
					? `Saved to server: ${filename}`
					: `Downloaded: ${filename}`;
			this.showNotification('success', successMessage, effectiveOptions.notificationMode);

			return { success: true, filename, taskId };
		} catch (error) {
			// Handle cancellation vs errors
			if (error instanceof DOMException && error.name === 'AbortError') {
				this.ui.completeTrackDownload(taskId!);
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
			const mappedError = isMappedDownloadError(error) ? error : mapDownloadError(error);
			this.ui.errorTrackDownload(taskId, mappedError.userMessage);
			this.showNotification('error', mappedError.userMessage, effectiveOptions.notificationMode);

			return {
				success: false,
				error: {
					code: mappedError.code,
					retry: mappedError.retry,
					message: mappedError.userMessage,
					originalError: mappedError.originalError
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
		this.ui.cancelTrackDownload(taskId);
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
		const downloadPrefs = get(downloadPreferencesStore);

		return resolveDownloadOptions(options, prefs, downloadPrefs);
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
		const errorContext = {
			component: 'download-orchestrator',
			domain: 'download',
			source: 'notification',
			severity: 'medium'
		};

		switch (mode) {
			case 'alert':
				if (type === 'error') {
					this.notifier.notify('error', message);
					this.notifier.trackError(new Error(message), errorContext);
				}
				break;
			case 'toast':
				this.notifier.notify(type, message);
				if (type === 'error') {
					this.notifier.trackError(new Error(message), errorContext);
				}
				break;
			case 'silent':
				// No notification
				break;
		}
	}
}

// Export singleton instance
export const downloadOrchestrator = new DownloadOrchestrator();
