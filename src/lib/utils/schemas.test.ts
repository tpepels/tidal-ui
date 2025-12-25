import { describe, it, expect } from 'vitest';
import {
	TrackSchema,
	AlbumSchema,
	ArtistSchema,
	PlaylistSchema,
	SearchResponseSchema,
	PlayerStateSchema,
	validateApiResponse,
	assertInvariant
} from './schemas';

describe('Schemas', () => {
	describe('TrackSchema', () => {
		it('validates valid track data', () => {
			const data = {
				id: 123,
				title: 'Test Track',
				artists: [{ id: 1, name: 'Artist' }],
				album: { id: 456, title: 'Test Album', cover: 'cover.jpg' },
				duration: 240,
				explicit: false
			};
			expect(() => TrackSchema.parse(data)).not.toThrow();
		});

		it('rejects invalid track data', () => {
			const data = {
				title: 'Test Track' // missing id
			};
			expect(() => TrackSchema.parse(data)).toThrow();
		});
	});

	describe('AlbumSchema', () => {
		it('validates valid album data', () => {
			const data = {
				id: 456,
				title: 'Test Album',
				artist: { id: 1, name: 'Artist' },
				cover: 'cover.jpg',
				releaseDate: '2023-01-01',
				numberOfTracks: 10
			};
			expect(() => AlbumSchema.parse(data)).not.toThrow();
		});
	});

	describe('ArtistSchema', () => {
		it('validates valid artist data', () => {
			const data = {
				id: 789,
				name: 'Test Artist',
				picture: 'pic.jpg'
			};
			expect(() => ArtistSchema.parse(data)).not.toThrow();
		});
	});

	describe('PlaylistSchema', () => {
		it('validates valid playlist data', () => {
			const data = {
				id: 'uuid-123',
				title: 'Test Playlist',
				description: 'A playlist',
				creator: { id: 1, name: 'User' },
				numberOfTracks: 20,
				cover: 'cover.jpg'
			};
			expect(() => PlaylistSchema.parse(data)).not.toThrow();
		});
	});

	describe('SearchResponseSchema', () => {
		it('validates search response', () => {
			const data = {
				items: [{ id: 1 }, { id: 2 }],
				totalNumberOfItems: 100,
				limit: 50,
				offset: 0
			};
			expect(() => SearchResponseSchema.parse(data)).not.toThrow();
		});
	});

	describe('PlayerStateSchema', () => {
		it('validates valid player state', () => {
			const data = {
				currentTrack: {
					id: 123,
					title: 'Track',
					artists: [{ name: 'Artist' }]
				},
				isPlaying: true,
				currentTime: 45,
				duration: 240,
				volume: 0.8,
				quality: 'LOSSLESS',
				qualitySource: 'auto',
				isLoading: false,
				queue: [{ id: 123, title: 'Track' }],
				queueIndex: 0
			};
			expect(() => PlayerStateSchema.parse(data)).not.toThrow();
		});

		it('rejects invalid volume', () => {
			const data = {
				currentTrack: null,
				isPlaying: false,
				currentTime: 0,
				duration: 0,
				volume: 1.5, // invalid
				quality: 'LOSSLESS',
				qualitySource: 'auto',
				isLoading: false,
				queue: [],
				queueIndex: -1
			};
			expect(() => PlayerStateSchema.parse(data)).toThrow();
		});
	});

	describe('validateApiResponse', () => {
		it('validates and returns data', () => {
			const data = { id: 123, title: 'Track' };
			const result = validateApiResponse(
				data,
				TrackSchema.omit({ artists: true, album: true, duration: true, explicit: true })
			);
			expect(result).toEqual(data);
		});

		it('throws on invalid data', () => {
			const data = { title: 'Track' }; // missing id
			expect(() => validateApiResponse(data, TrackSchema)).toThrow('Invalid API response');
		});
	});

	describe('assertInvariant', () => {
		it('does not throw on true condition', () => {
			expect(() => assertInvariant(true, 'test')).not.toThrow();
		});

		it('throws in dev mode on false condition', () => {
			// Mock DEV env
			const originalDev = import.meta.env.DEV;
			(import.meta.env as any).DEV = true;
			expect(() => assertInvariant(false, 'test')).toThrow('Invariant violation: test');
			(import.meta.env as any).DEV = originalDev;
		});
	});
});
