/**
 * Browse State Store
 *
 * Holds ephemeral UI navigation context that is COMPLETELY SEPARATE from playback state.
 *
 * INVARIANT: This store NEVER mutates playerState or playbackMachine.
 * Changes to browseState should NEVER affect what's currently playing.
 *
 * Use cases:
 * - Tracking which album/artist/playlist page the user is viewing
 * - Highlighting the currently hovered track in a list
 * - Storing navigation breadcrumbs
 *
 * NOT for:
 * - Now playing track (use playerStore)
 * - Playback status (use playbackMachine)
 * - Queue management (use playbackQueueCoordinator)
 */

import { writable, derived, get } from 'svelte/store';
import type { Album, Artist, Track } from '$lib/types';

export interface BrowseContext {
	// Currently viewed page context
	viewingAlbumId: number | null;
	viewingArtistId: number | null;
	viewingTrackId: number | null;
	viewingPlaylistId: string | null;

	// Cached metadata for display (prevents re-fetching)
	viewingAlbum: Album | null;
	viewingArtist: Artist | null;
	viewingTrack: Track | null;

	// UI interaction state
	hoveredTrackId: number | null;
	selectedTrackIds: Set<number>;

	// Navigation history for back button logic
	previousPath: string | null;
}

const initialState: BrowseContext = {
	viewingAlbumId: null,
	viewingArtistId: null,
	viewingTrackId: null,
	viewingPlaylistId: null,
	viewingAlbum: null,
	viewingArtist: null,
	viewingTrack: null,
	hoveredTrackId: null,
	selectedTrackIds: new Set(),
	previousPath: null
};

function createBrowseStore() {
	const { subscribe, set, update } = writable<BrowseContext>(initialState);

	return {
		subscribe,

		/**
		 * Set the currently viewed album.
		 * This does NOT affect playback - only UI display context.
		 */
		setViewingAlbum: (album: Album | null) => {
			update((state) => ({
				...state,
				viewingAlbumId: album?.id ?? null,
				viewingAlbum: album,
				// Clear other viewing contexts when navigating to album
				viewingTrackId: null,
				viewingTrack: null,
				viewingArtistId: null,
				viewingArtist: null,
				viewingPlaylistId: null
			}));
		},

		/**
		 * Set the currently viewed artist.
		 * This does NOT affect playback - only UI display context.
		 */
		setViewingArtist: (artist: Artist | null) => {
			update((state) => ({
				...state,
				viewingArtistId: artist?.id ?? null,
				viewingArtist: artist,
				// Clear other viewing contexts
				viewingAlbumId: null,
				viewingAlbum: null,
				viewingTrackId: null,
				viewingTrack: null,
				viewingPlaylistId: null
			}));
		},

		/**
		 * Set the currently viewed track.
		 * This does NOT affect playback - only UI display context.
		 */
		setViewingTrack: (track: Track | null) => {
			update((state) => ({
				...state,
				viewingTrackId: track?.id ?? null,
				viewingTrack: track
				// Don't clear album context - track is often viewed within album context
			}));
		},

		/**
		 * Set the currently viewed playlist.
		 */
		setViewingPlaylist: (playlistId: string | null) => {
			update((state) => ({
				...state,
				viewingPlaylistId: playlistId,
				// Clear other viewing contexts
				viewingAlbumId: null,
				viewingAlbum: null,
				viewingArtistId: null,
				viewingArtist: null,
				viewingTrackId: null,
				viewingTrack: null
			}));
		},

		/**
		 * Set hovered track (for UI highlighting).
		 */
		setHoveredTrack: (trackId: number | null) => {
			update((state) => ({
				...state,
				hoveredTrackId: trackId
			}));
		},

		/**
		 * Toggle track selection (for multi-select operations).
		 */
		toggleTrackSelection: (trackId: number) => {
			update((state) => {
				const newSelection = new Set(state.selectedTrackIds);
				if (newSelection.has(trackId)) {
					newSelection.delete(trackId);
				} else {
					newSelection.add(trackId);
				}
				return {
					...state,
					selectedTrackIds: newSelection
				};
			});
		},

		/**
		 * Clear all track selections.
		 */
		clearSelection: () => {
			update((state) => ({
				...state,
				selectedTrackIds: new Set()
			}));
		},

		/**
		 * Record previous path for back navigation.
		 */
		setPreviousPath: (path: string | null) => {
			update((state) => ({
				...state,
				previousPath: path
			}));
		},

		/**
		 * Clear all browse context (e.g., on logout or reset).
		 */
		reset: () => {
			set(initialState);
		},

		/**
		 * Get current snapshot without subscribing.
		 */
		getSnapshot: () => get({ subscribe })
	};
}

export const browseState = createBrowseStore();

// Derived stores for convenience
export const viewingAlbum = derived(browseState, ($state) => $state.viewingAlbum);
export const viewingArtist = derived(browseState, ($state) => $state.viewingArtist);
export const viewingTrack = derived(browseState, ($state) => $state.viewingTrack);
export const hoveredTrackId = derived(browseState, ($state) => $state.hoveredTrackId);
