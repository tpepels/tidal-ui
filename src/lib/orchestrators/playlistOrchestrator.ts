/**
 * Playlist Orchestrator
 *
 * Manages Spotify playlist conversion with progressive loading, cancellation support,
 * and optional auto-clear functionality.
 */

import type { SonglinkTrack } from '$lib/types';
import {
	convertSpotifyPlaylistToTracks,
	isSpotifyPlaylistUrl,
	type PlaylistConversionProgress as ServiceProgress,
	type PlaylistConversionResult as ServiceResult
} from '$lib/services/search/playlistConversionService';
import { searchStoreActions } from '$lib/stores/searchStoreAdapter';
import { get } from 'svelte/store';
import { searchStore } from '$lib/stores/searchStoreAdapter';

/**
 * Playlist conversion options
 */
export interface PlaylistConversionOptions {
	/** Whether to update searchStore during conversion */
	updateSearchStore?: boolean;

	/** Whether to clear query after successful conversion */
	clearQueryOnComplete?: boolean;

	/** Auto-clear results after specified duration (ms), 0 = disabled */
	autoClearAfterMs?: number;

	/** Progress callback (additional to store updates) */
	onProgress?: (progress: PlaylistConversionProgress) => void;

	/** AbortSignal for cancellation */
	signal?: AbortSignal;
}

/**
 * Playlist conversion result
 */
export interface PlaylistConversionResult {
	success: boolean;
	tracks?: SonglinkTrack[];
	failed?: string[];
	total?: number;
	error?: PlaylistConversionError;
}

/**
 * Error type for playlist conversion
 */
export type PlaylistConversionError =
	| { code: 'INVALID_URL'; retry: false; message: string }
	| { code: 'EMPTY_PLAYLIST'; retry: false; message: string }
	| { code: 'FETCH_FAILED'; retry: true; message: string; originalError?: unknown }
	| { code: 'CONVERSION_CANCELLED'; retry: false; message: string }
	| { code: 'ALL_TRACKS_FAILED'; retry: false; message: string; failedCount: number };

/**
 * Progress state for progressive updates
 */
export interface PlaylistConversionProgress {
	loaded: number;
	total: number;
	successful: SonglinkTrack[];
	failed: string[];
	phase: PlaylistConversionPhase;
}

export type PlaylistConversionPhase =
	| 'initializing'
	| 'fetching_tracks'
	| 'converting'
	| 'completed'
	| 'failed';

/**
 * Playlist Orchestrator Class
 * Manages Spotify playlist conversion with progressive UI updates
 */
export class PlaylistOrchestrator {
	/** Timer for auto-clear functionality */
	private autoClearTimer: ReturnType<typeof setTimeout> | null = null;

	/** Current conversion AbortController */
	private activeController: AbortController | null = null;

	/**
	 * Converts a Spotify playlist to TIDAL SonglinkTracks
	 *
	 * @param playlistUrl - Spotify playlist URL
	 * @param options - Conversion options
	 * @returns Promise resolving to conversion result
	 */
	async convertPlaylist(
		playlistUrl: string,
		options?: PlaylistConversionOptions
	): Promise<PlaylistConversionResult> {
		const trimmedUrl = playlistUrl.trim();

		if (!trimmedUrl) {
			return {
				success: false,
				error: {
					code: 'INVALID_URL',
					retry: false,
					message: 'Playlist URL cannot be empty'
				}
			};
		}

		if (!isSpotifyPlaylistUrl(trimmedUrl)) {
			return {
				success: false,
				error: {
					code: 'INVALID_URL',
					retry: false,
					message: 'URL is not a valid Spotify playlist URL'
				}
			};
		}

		const effectiveOptions = this.resolveOptions(options);

		// Cancel any existing conversion
		this.cancelConversion();

		// Create new AbortController
		this.activeController = effectiveOptions.signal ? null : new AbortController();

		const signal = effectiveOptions.signal ?? this.activeController?.signal;

		// Initialize store if enabled
		if (effectiveOptions.updateSearchStore) {
			this.initializeStoreState(trimmedUrl);
		}

		try {
			// Execute conversion with progress tracking
			const result = await convertSpotifyPlaylistToTracks(trimmedUrl, {
				onProgress: (progress: ServiceProgress) => {
					// Check for cancellation
					if (signal?.aborted) {
						throw new Error('CONVERSION_CANCELLED');
					}

					// Update store if enabled
					if (effectiveOptions.updateSearchStore) {
						this.updateStoreProgress(progress);
					}

					// Call additional progress callback
					effectiveOptions.onProgress?.({
						...progress,
						phase: 'converting'
					});
				},
				progressBatchSize: 5,
				progressThrottleMs: 100
			});

			// Handle empty results
			if (result.successful.length === 0) {
				const error: PlaylistConversionError = {
					code: 'ALL_TRACKS_FAILED',
					retry: false,
					message: 'Could not convert any tracks from this playlist',
					failedCount: result.failed.length
				};

				if (effectiveOptions.updateSearchStore) {
					this.setStoreError(error.message);
				}

				return { success: false, error };
			}

			// Success!
			if (effectiveOptions.updateSearchStore) {
				this.finalizeStoreState(result, effectiveOptions.clearQueryOnComplete);
			}

			// Set up auto-clear if enabled
			if (effectiveOptions.autoClearAfterMs > 0) {
				this.scheduleAutoClear(effectiveOptions.autoClearAfterMs);
			}

			return {
				success: true,
				tracks: result.successful,
				failed: result.failed,
				total: result.total
			};
		} catch (error) {
			const classifiedError = this.classifyError(error);

			if (effectiveOptions.updateSearchStore && classifiedError.code !== 'CONVERSION_CANCELLED') {
				this.setStoreError(classifiedError.message);
			}

			return { success: false, error: classifiedError };
		} finally {
			this.activeController = null;
		}
	}

	/**
	 * Provides AsyncGenerator for progressive playlist conversion
	 * Allows component to consume tracks as they're converted
	 *
	 * @param playlistUrl - Spotify playlist URL
	 * @param options - Conversion options
	 * @yields Progress updates with incremental tracks
	 */
	async *convertPlaylistProgressive(
		playlistUrl: string,
		options?: Omit<PlaylistConversionOptions, 'onProgress'>
	): AsyncGenerator<PlaylistConversionProgress, void, unknown> {
		const trimmedUrl = playlistUrl.trim();

		if (!trimmedUrl || !isSpotifyPlaylistUrl(trimmedUrl)) {
			yield {
				loaded: 0,
				total: 0,
				successful: [],
				failed: [],
				phase: 'failed'
			};
			return;
		}

		yield {
			loaded: 0,
			total: 0,
			successful: [],
			failed: [],
			phase: 'initializing'
		};

		const effectiveOptions = this.resolveOptions(options);
		this.activeController = effectiveOptions.signal ? null : new AbortController();
		const signal = effectiveOptions.signal ?? this.activeController?.signal;

		try {
			const progressUpdates: PlaylistConversionProgress[] = [];

			const result = await convertSpotifyPlaylistToTracks(trimmedUrl, {
				onProgress: (progress: ServiceProgress) => {
					if (signal?.aborted) {
						throw new Error('CONVERSION_CANCELLED');
					}

					const progressState: PlaylistConversionProgress = {
						...progress,
						phase: 'converting'
					};

					progressUpdates.push(progressState);
				},
				progressBatchSize: 1, // Yield every track for fine-grained control
				progressThrottleMs: 0 // No throttling for generator
			});

			// Yield final completed state
			if (progressUpdates.length > 0) {
				yield {
					loaded: result.total,
					total: result.total,
					successful: result.successful,
					failed: result.failed,
					phase: 'completed' as const
				};
			}
		} catch {
			yield {
				loaded: 0,
				total: 0,
				successful: [],
				failed: [],
				phase: 'failed'
			};
		} finally {
			this.activeController = null;
		}
	}

	/**
	 * Cancels any in-progress playlist conversion
	 */
	cancelConversion(): void {
		if (this.activeController) {
			this.activeController.abort();
			this.activeController = null;
		}

		this.clearAutoClearTimer();

		// Update store if it's in playlist mode
		const state = get(searchStore);
		if (state.isPlaylistConversionMode) {
			searchStoreActions.commit({
				isLoading: false,
				isPlaylistConversionMode: false,
				playlistLoadingMessage: null
			});
		}
	}

	/**
	 * Manually clears playlist results (for use with auto-clear)
	 */
	clearPlaylistResults(): void {
		this.clearAutoClearTimer();

		searchStoreActions.commit({
			query: '',
			results: null,
			isPlaylistConversionMode: false,
			playlistConversionTotal: 0,
			playlistLoadingMessage: null
		});
	}

	// === PRIVATE METHODS ===

	private initializeStoreState(url: string): void {
		searchStoreActions.commit({
			query: url,
			activeTab: 'tracks',
			isLoading: true,
			error: null,
			results: { tracks: [], albums: [], artists: [], playlists: [] },
			isPlaylistConversionMode: true,
			playlistConversionTotal: 0,
			playlistLoadingMessage: 'Loading playlist...'
		});
	}

	private updateStoreProgress(progress: ServiceProgress): void {
		searchStoreActions.commit({
			playlistConversionTotal: progress.total,
			playlistLoadingMessage: `Loaded ${progress.loaded}/${progress.total} tracks...`,
			results: {
				tracks: progress.successful,
				albums: [],
				artists: [],
				playlists: []
			}
		});
	}

	private finalizeStoreState(result: ServiceResult, clearQuery: boolean): void {
		searchStoreActions.commit({
			query: clearQuery ? '' : get(searchStore).query,
			isLoading: false,
			error: null,
			results: {
				tracks: result.successful,
				albums: [],
				artists: [],
				playlists: []
			},
			isPlaylistConversionMode: false,
			playlistLoadingMessage: null,
			playlistConversionTotal: result.total
		});
	}

	private setStoreError(message: string): void {
		searchStoreActions.commit({
			error: message,
			isLoading: false,
			isPlaylistConversionMode: false,
			playlistLoadingMessage: null
		});
	}

	private scheduleAutoClear(delayMs: number): void {
		this.clearAutoClearTimer();

		this.autoClearTimer = setTimeout(() => {
			this.clearPlaylistResults();
		}, delayMs);
	}

	private clearAutoClearTimer(): void {
		if (this.autoClearTimer) {
			clearTimeout(this.autoClearTimer);
			this.autoClearTimer = null;
		}
	}

	private classifyError(error: unknown): PlaylistConversionError {
		if (error instanceof Error) {
			const message = error.message;

			if (message === 'CONVERSION_CANCELLED' || message.includes('abort')) {
				return {
					code: 'CONVERSION_CANCELLED',
					retry: false,
					message: 'Playlist conversion was cancelled'
				};
			}

			if (message.includes('empty') || message.includes('no tracks')) {
				return {
					code: 'EMPTY_PLAYLIST',
					retry: false,
					message: 'Playlist is empty or contains no valid tracks'
				};
			}

			return {
				code: 'FETCH_FAILED',
				retry: true,
				message: error.message,
				originalError: error
			};
		}

		return {
			code: 'FETCH_FAILED',
			retry: true,
			message: typeof error === 'string' ? error : 'Failed to convert playlist',
			originalError: error
		};
	}

	private resolveOptions(
		options?: PlaylistConversionOptions
	): Required<Omit<PlaylistConversionOptions, 'signal' | 'onProgress'>> &
		Pick<PlaylistConversionOptions, 'signal' | 'onProgress'> {
		return {
			updateSearchStore: options?.updateSearchStore ?? true,
			clearQueryOnComplete: options?.clearQueryOnComplete ?? false,
			autoClearAfterMs: options?.autoClearAfterMs ?? 0,
			onProgress: options?.onProgress,
			signal: options?.signal
		};
	}
}

// Export singleton instance
export const playlistOrchestrator = new PlaylistOrchestrator();
