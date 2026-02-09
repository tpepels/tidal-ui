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
import { DownloadQueue, type DownloadQueueConfig } from '$lib/core/downloadQueue';
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
	| MappedDownloadError
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

	/** Map of task ID to queued download ID for correlation */
	private taskToQueueId = new Map<string, string>();

	/** Queue for sequential download processing */
	private downloadQueue: DownloadQueue;

	/** Failed downloads for user visibility */
	private failedDownloads = new Map<string, { taskId: string; error: string; track: PlayableTrack }>();

	/** Maximum number of stored attempts (prevents memory leak) */
	private readonly MAX_STORED_ATTEMPTS = 50;
	private readonly ui: DownloadUiPort;
	private readonly log: DownloadLogPort;
	private readonly notifier: DownloadNotificationPort;
	private readonly trackResolver: TrackResolver;
	private readonly execution: DownloadExecutionPort;
	private readonly executors: ReturnType<typeof createDownloadExecutors>;

	constructor(deps?: DownloadOrchestratorDeps, queueConfig?: DownloadQueueConfig) {
		this.ui = deps?.ui ?? createDownloadUiPort();
		this.log = deps?.log ?? createDownloadLogPort();
		this.notifier = deps?.notifier ?? createDownloadNotificationPort();
		this.trackResolver = deps?.trackResolver ?? createTrackResolver();
		this.execution = deps?.execution ?? createDownloadExecutionPort();
		this.executors = createDownloadExecutors(this.execution);

		// Initialize download queue with callbacks
		this.downloadQueue = new DownloadQueue(
			{
				maxConcurrent: queueConfig?.maxConcurrent ?? 4,
				maxRetries: queueConfig?.maxRetries ?? 3,
				autoRetryFailures: queueConfig?.autoRetryFailures ?? true
			},
			{
				onStarted: (item) => {
					this.log.log(`Starting download: ${item.trackId} (attempt ${item.retryCount + 1})`);
				},
				onCompleted: (item) => {
					this.log.success(`Download completed: ${item.trackId}`);
					this.failedDownloads.delete(item.id);
				},
				onFailed: (item, error) => {
					const taskId = this.taskToQueueId.get(item.id);
					if (taskId) {
						this.ui.errorTrackDownload(taskId, error.message);
					}
					// Store failed download for display
					const attempt = this.downloadAttempts.get(item.id);
					if (attempt) {
						this.failedDownloads.set(item.id, {
							taskId: item.id,
							error: error.message,
							track: attempt.track
						});
					}
					this.log.error(`Download failed: ${item.trackId} - ${error.message}`);
				},
				onRetry: (item, attempt) => {
					this.log.warning(
						`Re-queuing download: ${item.trackId} (attempt ${attempt}/${item.maxRetries})`
					);
				}
			}
		);
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
					? `Saved: ${targetTrack.title}`
					: `Downloaded: ${targetTrack.title}`;
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

			// Handle other errors - mark for re-queue
			const mappedError = isMappedDownloadError(error) ? error : mapDownloadError(error);
			this.ui.errorTrackDownload(taskId, mappedError.userMessage);
			this.showNotification('error', mappedError.userMessage, effectiveOptions.notificationMode);

			// Store failed download for later retry
			this.failedDownloads.set(taskId, {
				taskId,
				error: mappedError.userMessage,
				track
			});

			// Log for operator visibility
			this.log.error(
				`Download failed (can be retried): ${track.title} - ${mappedError.userMessage}`
			);

			return {
				success: false,
				error: mappedError,
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
	 * Get list of failed downloads that can be retried
	 */
	getFailedDownloads() {
		return Array.from(this.failedDownloads.values());
	}

	/**
	 * Retry a specific failed download
	 */
	async retryFailedDownload(failedId: string): Promise<DownloadOrchestratorResult> {
		const failed = this.failedDownloads.get(failedId);
		if (!failed) {
			return {
				success: false,
				error: {
					code: 'UNKNOWN_ERROR',
					retry: false,
					message: 'Failed download not found'
				}
			};
		}

		// Retry using the stored attempt
		const result = await this.retryDownload(failed.taskId);
		
		// Remove from failed list if retry succeeds
		if (result.success) {
			this.failedDownloads.delete(failedId);
		}

		return result;
	}

	/**
	 * Retry all failed downloads
	 */
	async retryAllFailedDownloads(): Promise<DownloadOrchestratorResult[]> {
		const failedIds = Array.from(this.failedDownloads.keys());
		const results = await Promise.all(
			failedIds.map(id => this.retryFailedDownload(id))
		);
		return results;
	}

	/**
	 * Get current download queue status
	 */
	getQueueStatus() {
		return this.downloadQueue.getStatus();
	}

	/**
	 * Pause all downloads in the queue
	 */
	pauseQueue(): void {
		this.downloadQueue.pause();
	}

	/**
	 * Resume queued downloads
	 */
	resumeQueue(): void {
		this.downloadQueue.resume();
	}

	/**
	 * Stop all downloads and clear the queue
	 */
	stopQueue(): void {
		this.downloadQueue.stop();
	}

	/**
	 * Restart the download queue
	 */
	restartQueue(): void {
		this.downloadQueue.restart();
	}

	/**
	 * Clear all failed downloads
	 */
	clearFailedDownloads(): void {
		this.failedDownloads.clear();
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

		// Success messages from downloads are subtle - only log them
		if (type === 'success') {
			this.log.success(message);
			return;
		}

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
