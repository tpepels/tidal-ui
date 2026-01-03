/**
 * Search Orchestrator
 *
 * Coordinates search workflows with intelligent URL routing, streaming conversion,
 * and playlist delegation. Detects query type and routes to appropriate workflow.
 */

import type { Track, Album, Playlist } from '$lib/types';
import type { SearchTab } from '$lib/stores/searchStoreAdapter';
import type { RegionOption } from '$lib/stores/region';
import { searchStoreActions } from '$lib/stores/searchStoreAdapter';
import { playerStore } from '$lib/stores/player';
import { toasts } from '$lib/stores/toasts';
import { executeTabSearch, type SearchError, type SearchResults } from '$lib/services/search/searchService';
import {
	convertStreamingUrl,
	type ConversionError
} from '$lib/services/search/streamingUrlConversionService';
import { precacheTrackStream } from '$lib/services/search/streamingUrlConversionService';
import { playlistOrchestrator } from './playlistOrchestrator';
import { isTidalUrl } from '$lib/utils/urlParser';
import { isSupportedStreamingUrl, isSpotifyPlaylistUrl } from '$lib/utils/songlink';
import { get } from 'svelte/store';

/**
 * Search orchestration options
 */
export interface SearchOrchestratorOptions {
	/** Region for search */
	region?: RegionOption;

	/** Whether to show toast notifications on error */
	showErrorToasts?: boolean;
}

/**
 * Result from search workflow orchestration
 */
export type SearchWorkflowResult =
	| { workflow: 'standard'; success: true; results: SearchResults }
	| { workflow: 'standard'; success: false; error: SearchError }
	| { workflow: 'playlist'; success: true; delegated: true }
	| { workflow: 'playlist'; success: false; error: unknown }
	| {
			workflow: 'streamingUrl';
			success: true;
			action: 'play' | 'showAlbum' | 'showPlaylist';
			data: Track | Album | Playlist;
	  }
	| { workflow: 'streamingUrl'; success: false; error: ConversionError };

/**
 * URL type detection result
 */
export type UrlType = 'tidal' | 'streaming' | 'spotify-playlist' | 'none';

/**
 * Search Orchestrator Class
 * Manages search workflows with automatic URL detection and routing
 */
export class SearchOrchestrator {
	/**
	 * Detects the type of URL in the query
	 *
	 * @param query - Query string to analyze
	 * @returns URL type classification
	 */
	detectUrlType(query: string): UrlType {
		const trimmed = query.trim();
		if (!trimmed) return 'none';

		if (isSpotifyPlaylistUrl(trimmed)) return 'spotify-playlist';
		if (isSupportedStreamingUrl(trimmed)) return 'streaming';
		if (isTidalUrl(trimmed)) return 'tidal';

		return 'none';
	}

	/**
	 * Orchestrates search workflow with automatic URL routing
	 *
	 * @param query - Search query or URL
	 * @param tab - Active search tab
	 * @param options - Search options
	 * @returns Promise resolving to workflow result
	 */
	async search(
		query: string,
		tab: SearchTab,
		options?: SearchOrchestratorOptions
	): Promise<SearchWorkflowResult> {
		const trimmedQuery = query.trim();
		if (!trimmedQuery) {
			return {
				workflow: 'standard',
				success: false,
				error: {
					code: 'INVALID_QUERY',
					retry: false,
					message: 'Query cannot be empty'
				}
			};
		}

		// Detect URL type and route to appropriate workflow
		const urlType = this.detectUrlType(trimmedQuery);

		switch (urlType) {
			case 'spotify-playlist':
				return this.handlePlaylistWorkflow(trimmedQuery);

			case 'streaming':
			case 'tidal':
				return this.handleStreamingUrlWorkflow(trimmedQuery);

			case 'none':
			default:
				return this.handleStandardSearchWorkflow(trimmedQuery, tab, options);
		}
	}

	/**
	 * Changes the active search tab
	 *
	 * @param tab - Tab to switch to
	 */
	changeTab(tab: SearchTab): void {
		searchStoreActions.commit({ activeTab: tab });
	}

	/**
	 * Clears search state
	 */
	clear(): void {
		searchStoreActions.commit({
			query: '',
			results: null,
			error: null,
			isLoading: false,
			tabLoading: {
				tracks: false,
				albums: false,
				artists: false,
				playlists: false
			}
		});
	}

	// === PRIVATE WORKFLOW HANDLERS ===

	/**
	 * Handles standard search workflow (non-URL queries)
	 */
	private async handleStandardSearchWorkflow(
		query: string,
		tab: SearchTab,
		options: SearchOrchestratorOptions | undefined
	): Promise<SearchWorkflowResult> {
		// Update store to loading state
		searchStoreActions.search(query, tab);

		try {
			// Execute search via service
			const result = await executeTabSearch(query, tab, options?.region);

			if (!result.success) {
				// Update store with error
				searchStoreActions.commit({
					error: result.error.message,
					isLoading: false,
					tabLoading: {
						tracks: false,
						albums: false,
						artists: false,
						playlists: false
					}
				});

				// Show toast with retry option
				if (options?.showErrorToasts !== false && result.error.retry) {
					toasts.error(`Search failed: ${result.error.message}`, {
						action: {
							label: 'Retry',
							handler: () => this.search(query, tab, options)
						}
					});
				}

				return { workflow: 'standard', success: false, error: result.error };
			}

			// Update store with results
			searchStoreActions.commit({
				results: result.results,
				isLoading: false,
				error: null,
				tabLoading: {
					tracks: false,
					albums: false,
					artists: false,
					playlists: false
				}
			});

			return { workflow: 'standard', success: true, results: result.results };
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Search failed';
			const searchError: SearchError = {
				code: 'UNKNOWN_ERROR',
				retry: false,
				message,
				originalError: error
			};

			searchStoreActions.commit({
				error: message,
				isLoading: false,
				tabLoading: {
					tracks: false,
					albums: false,
					artists: false,
					playlists: false
				}
			});

			console.error('[SearchOrchestrator] Search error:', error);

			return { workflow: 'standard', success: false, error: searchError };
		}
	}

	/**
	 * Handles streaming URL conversion workflow (Spotify/Apple Music/YouTube links)
	 */
	private async handleStreamingUrlWorkflow(url: string): Promise<SearchWorkflowResult> {
		// Update store to loading state
		searchStoreActions.commit({
			isLoading: true,
			error: null,
			tabLoading: {
				tracks: false,
				albums: false,
				artists: false,
				playlists: false
			}
		});

		try {
			// Convert streaming URL to TIDAL content
			const conversionResult = await convertStreamingUrl(url);

			if (!conversionResult.success) {
				// Update store with error
				searchStoreActions.commit({
					error: conversionResult.error.message,
					isLoading: false,
					tabLoading: {
						tracks: false,
						albums: false,
						artists: false,
						playlists: false
					}
				});

				return {
					workflow: 'streamingUrl',
					success: false,
					error: conversionResult.error
				};
			}

			const { type, track, album, playlist } = conversionResult.data;

			// Route based on content type
			switch (type) {
				case 'track': {
					if (!track) {
						throw new Error('Track data missing from conversion result');
					}

					// Pre-cache the stream URL for immediate playback
					const currentQuality = get(playerStore).quality;
					await precacheTrackStream(track.id, currentQuality);

					// Play track immediately
					playerStore.setTrack(track);
					playerStore.play();

					// Clear query
					searchStoreActions.commit({ query: '', isLoading: false });

					return {
						workflow: 'streamingUrl',
						success: true,
						action: 'play',
						data: track
					};
				}

				case 'album': {
					if (!album) {
						throw new Error('Album data missing from conversion result');
					}

					// Show album in results
					searchStoreActions.commit({
						activeTab: 'albums',
						results: {
							tracks: [],
							albums: [album],
							artists: [],
							playlists: []
						},
						query: '',
						isLoading: false
					});

					return {
						workflow: 'streamingUrl',
						success: true,
						action: 'showAlbum',
						data: album
					};
				}

				case 'playlist': {
					if (!playlist) {
						throw new Error('Playlist data missing from conversion result');
					}

					// Show playlist in results
					searchStoreActions.commit({
						activeTab: 'playlists',
						results: {
							tracks: [],
							albums: [],
							artists: [],
							playlists: [playlist]
						},
						query: '',
						isLoading: false
					});

					return {
						workflow: 'streamingUrl',
						success: true,
						action: 'showPlaylist',
						data: playlist
					};
				}

				default:
					throw new Error(`Unknown content type: ${type}`);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Failed to convert URL';

			searchStoreActions.commit({
				error: message,
				isLoading: false,
				tabLoading: {
					tracks: false,
					albums: false,
					artists: false,
					playlists: false
				}
			});

			console.error('[SearchOrchestrator] Streaming URL conversion error:', error);

			return {
				workflow: 'streamingUrl',
				success: false,
				error: {
					code: 'UNKNOWN_ERROR',
					retry: false,
					message,
					originalError: error
				}
			};
		}
	}

	/**
	 * Handles Spotify playlist conversion workflow (delegates to playlistOrchestrator)
	 */
	private async handlePlaylistWorkflow(url: string): Promise<SearchWorkflowResult> {
		try {
			// Delegate to playlist orchestrator
			const result = await playlistOrchestrator.convertPlaylist(url, {
				updateSearchStore: true,
				clearQueryOnComplete: true,
				autoClearAfterMs: 3000
			});

			if (!result.success) {
				return {
					workflow: 'playlist',
					success: false,
					error: result.error
				};
			}

			return {
				workflow: 'playlist',
				success: true,
				delegated: true
			};
		} catch (error) {
			console.error('[SearchOrchestrator] Playlist conversion error:', error);

			return {
				workflow: 'playlist',
				success: false,
				error: error instanceof Error ? error.message : 'Playlist conversion failed'
			};
		}
	}
}

// Export singleton instance
export const searchOrchestrator = new SearchOrchestrator();
