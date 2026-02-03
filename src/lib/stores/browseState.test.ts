/**
 * Browse State Tests
 *
 * Critical invariant: browseState changes should NEVER affect playback state.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { browseState, viewingAlbum, viewingArtist, viewingTrack } from './browseState';
import type { Album, Artist, Track } from '$lib/types';

// Mock data - using type assertions since we only need subset of fields for these tests
const mockAlbum = {
	id: 123,
	title: 'Test Album',
	cover: 'cover-123',
	numberOfTracks: 10,
	releaseDate: '2024-01-01'
} as Album;

const mockArtist = {
	id: 456,
	name: 'Test Artist',
	picture: 'picture-456',
	type: 'MAIN'
} as Artist;

const mockTrack = {
	id: 789,
	title: 'Test Track',
	duration: 180,
	trackNumber: 1,
	artist: mockArtist,
	artists: [mockArtist],
	album: mockAlbum
} as Track;

const mockTrack2 = {
	id: 790,
	title: 'Test Track 2',
	duration: 200,
	trackNumber: 2,
	artist: mockArtist,
	artists: [mockArtist],
	album: mockAlbum
} as Track;

describe('browseState', () => {
	beforeEach(() => {
		// Reset browse state before each test
		browseState.reset();
	});

	describe('viewing album', () => {
		it('should set viewing album correctly', () => {
			browseState.setViewingAlbum(mockAlbum);

			const state = get(browseState);
			expect(state.viewingAlbumId).toBe(123);
			expect(state.viewingAlbum).toEqual(mockAlbum);
		});

		it('should clear other viewing contexts when setting album', () => {
			browseState.setViewingTrack(mockTrack);
			browseState.setViewingAlbum(mockAlbum);

			const state = get(browseState);
			expect(state.viewingAlbumId).toBe(123);
			expect(state.viewingTrackId).toBeNull();
			expect(state.viewingArtistId).toBeNull();
		});

		it('should set null album correctly', () => {
			browseState.setViewingAlbum(mockAlbum);
			browseState.setViewingAlbum(null);

			const state = get(browseState);
			expect(state.viewingAlbumId).toBeNull();
			expect(state.viewingAlbum).toBeNull();
		});
	});

	describe('viewing track', () => {
		it('should set viewing track correctly', () => {
			browseState.setViewingTrack(mockTrack);

			const state = get(browseState);
			expect(state.viewingTrackId).toBe(789);
			expect(state.viewingTrack).toEqual(mockTrack);
		});

		it('should NOT clear album context when setting track', () => {
			browseState.setViewingAlbum(mockAlbum);
			browseState.setViewingTrack(mockTrack);

			const state = get(browseState);
			expect(state.viewingTrackId).toBe(789);
			// Album context preserved (track is within album)
			expect(state.viewingAlbumId).toBe(123);
		});
	});

	describe('viewing artist', () => {
		it('should set viewing artist correctly', () => {
			browseState.setViewingArtist(mockArtist);

			const state = get(browseState);
			expect(state.viewingArtistId).toBe(456);
			expect(state.viewingArtist).toEqual(mockArtist);
		});

		it('should clear other viewing contexts when setting artist', () => {
			browseState.setViewingAlbum(mockAlbum);
			browseState.setViewingArtist(mockArtist);

			const state = get(browseState);
			expect(state.viewingArtistId).toBe(456);
			expect(state.viewingAlbumId).toBeNull();
			expect(state.viewingTrackId).toBeNull();
		});
	});

	describe('hover and selection', () => {
		it('should set hovered track', () => {
			browseState.setHoveredTrack(789);

			expect(get(browseState).hoveredTrackId).toBe(789);
		});

		it('should clear hovered track', () => {
			browseState.setHoveredTrack(789);
			browseState.setHoveredTrack(null);

			expect(get(browseState).hoveredTrackId).toBeNull();
		});

		it('should toggle track selection', () => {
			browseState.toggleTrackSelection(789);
			expect(get(browseState).selectedTrackIds.has(789)).toBe(true);

			browseState.toggleTrackSelection(789);
			expect(get(browseState).selectedTrackIds.has(789)).toBe(false);
		});

		it('should support multi-select', () => {
			browseState.toggleTrackSelection(789);
			browseState.toggleTrackSelection(790);

			const selection = get(browseState).selectedTrackIds;
			expect(selection.has(789)).toBe(true);
			expect(selection.has(790)).toBe(true);
		});

		it('should clear selection', () => {
			browseState.toggleTrackSelection(789);
			browseState.toggleTrackSelection(790);
			browseState.clearSelection();

			expect(get(browseState).selectedTrackIds.size).toBe(0);
		});
	});

	describe('derived stores', () => {
		it('viewingAlbum derived store should update', () => {
			expect(get(viewingAlbum)).toBeNull();

			browseState.setViewingAlbum(mockAlbum);
			expect(get(viewingAlbum)).toEqual(mockAlbum);
		});

		it('viewingArtist derived store should update', () => {
			expect(get(viewingArtist)).toBeNull();

			browseState.setViewingArtist(mockArtist);
			expect(get(viewingArtist)).toEqual(mockArtist);
		});

		it('viewingTrack derived store should update', () => {
			expect(get(viewingTrack)).toBeNull();

			browseState.setViewingTrack(mockTrack);
			expect(get(viewingTrack)).toEqual(mockTrack);
		});
	});

	describe('reset', () => {
		it('should reset all browse state', () => {
			browseState.setViewingAlbum(mockAlbum);
			browseState.setViewingArtist(mockArtist);
			browseState.setViewingTrack(mockTrack);
			browseState.setHoveredTrack(789);
			browseState.toggleTrackSelection(789);

			browseState.reset();

			const state = get(browseState);
			expect(state.viewingAlbumId).toBeNull();
			expect(state.viewingArtistId).toBeNull();
			expect(state.viewingTrackId).toBeNull();
			expect(state.hoveredTrackId).toBeNull();
			expect(state.selectedTrackIds.size).toBe(0);
		});
	});

	describe('getSnapshot', () => {
		it('should return current state without subscribing', () => {
			browseState.setViewingAlbum(mockAlbum);

			const snapshot = browseState.getSnapshot();
			expect(snapshot.viewingAlbumId).toBe(123);
		});
	});
});
