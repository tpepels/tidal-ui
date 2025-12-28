import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
	TrackSchema,
	AlbumSchema,
	ArtistSchema,
	PlaylistSchema,
	SearchResponseSchema,
	PlayerStateSchema,
	TrackSearchResponseSchema,
	AlbumSearchResponseSchema,
	ArtistSearchResponseSchema,
	PlaylistSearchResponseSchema,
	AlbumWithTracksSchema,
	PlaylistWithTracksSchema,
	CoverImageSchema,
	LyricsSchema,
	StreamDataSchema,
	validateApiResponse,
	assertInvariant,
	safeValidateApiResponse,
	validateApiResponseGracefully,
	getUserFriendlyValidationError
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
			expect(() =>
				validateApiResponse({ id: undefined, artists: undefined }, TrackSchema)
			).toThrow();
		});
	});

	describe('assertInvariant', () => {
		it('does not throw on true condition', () => {
			expect(() => assertInvariant(true, 'test')).not.toThrow();
		});

		it('throws in dev mode on false condition', () => {
			// Mock DEV env
			const originalDev = import.meta.env.DEV;
			expect(() => assertInvariant(false, 'test')).toThrow('Invariant violation: test');
		});
	});

	describe('API Response Schema Validation Integration', () => {
		describe('Search Response Schemas', () => {
			it('validates track search response', () => {
				const searchResponse = {
					items: [
						{ id: 1, title: 'Track 1', artists: [{ name: 'Artist 1' }] },
						{ id: 2, title: 'Track 2', artists: [{ name: 'Artist 2' }] }
					],
					totalNumberOfItems: 2,
					limit: 20,
					offset: 0
				};

				const result = safeValidateApiResponse(searchResponse, TrackSearchResponseSchema);
				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data.items).toHaveLength(2);
				}
			});

			it('validates album search response', () => {
				const searchResponse = {
					items: [{ id: 1, title: 'Album 1', artist: { name: 'Artist 1' } }],
					totalNumberOfItems: 1,
					limit: 20,
					offset: 0
				};

				const result = safeValidateApiResponse(searchResponse, AlbumSearchResponseSchema);
				expect(result.success).toBe(true);
			});

			it('handles empty search results', () => {
				const emptyResponse = {
					items: [],
					totalNumberOfItems: 0,
					limit: 20,
					offset: 0
				};

				const result = safeValidateApiResponse(emptyResponse, TrackSearchResponseSchema);
				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data.items).toHaveLength(0);
				}
			});

			it('handles empty search results', () => {
				const emptyResponse = {
					items: [],
					totalNumberOfItems: 0,
					limit: 20,
					offset: 0
				};

				const result = safeValidateApiResponse(emptyResponse, TrackSearchResponseSchema);
				expect(result.success).toBe(true);
				expect(result.data.items).toHaveLength(0);
			});
		});

		describe('Complex Response Schemas', () => {
			it('validates album with tracks response', () => {
				const albumWithTracks = {
					album: {
						id: 123,
						title: 'Test Album',
						artist: { id: 456, name: 'Test Artist' }
					},
					tracks: [
						{ id: 1, title: 'Track 1', artists: [{ name: 'Artist 1' }] },
						{ id: 2, title: 'Track 2', artists: [{ name: 'Artist 2' }] }
					]
				};

				const result = safeValidateApiResponse(albumWithTracks, AlbumWithTracksSchema);
				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data.album.title).toBe('Test Album');
					expect(result.data.tracks).toHaveLength(2);
				}
			});

			it('validates playlist with tracks response', () => {
				const playlistWithTracks = {
					playlist: {
						id: 'playlist-123',
						title: 'Test Playlist',
						creator: { id: 456, name: 'Test User' }
					},
					items: [
						{ item: { id: 1, title: 'Track 1', artists: [{ name: 'Artist 1' }] } },
						{ item: { id: 2, title: 'Track 2', artists: [{ name: 'Artist 2' }] } }
					]
				};

				const result = safeValidateApiResponse(playlistWithTracks, PlaylistWithTracksSchema);
				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data.playlist.title).toBe('Test Playlist');
				}
			});
		});

		describe('Stream and Media Schemas', () => {
			it('validates stream data', () => {
				const streamData = {
					url: 'https://example.com/stream',
					replayGain: -6.5,
					sampleRate: 44100,
					bitDepth: 16
				};

				const result = safeValidateApiResponse(streamData, StreamDataSchema);
				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data.url).toBe('https://example.com/stream');
				}
			});

			it('validates cover images', () => {
				const coverImages = [
					{ url: 'https://example.com/cover1.jpg', width: 300, height: 300 },
					{ url: 'https://example.com/cover2.jpg' }
				];

				const result = safeValidateApiResponse(coverImages, z.array(CoverImageSchema));
				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data).toHaveLength(2);
				}
			});

			it('validates lyrics', () => {
				const lyrics = {
					trackId: 123,
					lyrics: '[00:00] Test lyrics',
					syncType: 'LINE_SYNCED',
					provider: 'Tidal'
				};

				const result = safeValidateApiResponse(lyrics, LyricsSchema);
				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data.trackId).toBe(123);
				}
			});
		});

		describe('Graceful Error Handling', () => {
			it('provides user-friendly error messages for critical failures', () => {
				const invalidData = { wrongField: 'value' };

				expect(() => {
					validateApiResponseGracefully(invalidData, TrackSchema, 'track data');
				}).toThrow(
					'Unable to process track data: The server returned incomplete data. Please try again.'
				);
			});

			it('continues with fallback data for non-critical failures', () => {
				const invalidData = { wrongField: 'value' };
				const fallback = { id: 999, title: 'Fallback Track', artists: [{ name: 'Unknown' }] };

				// For non-critical context, should return fallback
				const result = validateApiResponseGracefully(
					invalidData,
					TrackSchema,
					'search results', // Non-critical context
					fallback
				);
				expect(result.id).toBe(999);
				expect(result.title).toBe('Fallback Track');
			});

			it('converts validation errors to user-friendly messages', () => {
				expect(
					getUserFriendlyValidationError('Required', 'expected number, received undefined')
				).toContain('incomplete data');
				expect(
					getUserFriendlyValidationError('Invalid', 'expected array, received string')
				).toContain('unexpected data format');
				expect(getUserFriendlyValidationError('too_big', 'array error')).toContain(
					'could not be processed'
				);
				expect(getUserFriendlyValidationError('unknown', 'some error')).toContain(
					'could not be processed'
				);
			});
		});

		describe('Edge Cases and Robustness', () => {
			it('handles null and undefined values gracefully', () => {
				let result = safeValidateApiResponse(null, TrackSchema);
				expect(result.success).toBe(false);

				result = safeValidateApiResponse(undefined, TrackSchema);
				expect(result.success).toBe(false);
			});

			it('handles malformed JSON-like data', () => {
				const malformed = {
					id: 123,
					title: 'Test',
					artists: 'not-an-array', // Should be array
					album: { id: 'not-a-number' } // Should be number
				};

				const result = safeValidateApiResponse(malformed, TrackSchema);
				expect(result.success).toBe(false);
				if (!result.success) {
					expect(result.error).toContain('Invalid input');
				}
			});

			it('validates deeply nested object structures', () => {
				const nestedData = {
					id: 123,
					title: 'Test Track',
					artists: [
						{
							id: 456,
							name: 'Test Artist',
							type: 'artist',
							artistTypes: ['MAIN'],
							artistRoles: ['Artist'],
							picture: 'artist.jpg'
						}
					],
					album: {
						id: 789,
						title: 'Test Album',
						cover: 'album.jpg',
						artist: { id: 456, name: 'Test Artist' },
						releaseDate: '2023-01-01',
						numberOfTracks: 10
					}
				};

				const result = safeValidateApiResponse(nestedData, TrackSchema);
				expect(result.success).toBe(true);
				if (result.success) {
					expect(result.data.album?.artist?.name).toBe('Test Artist');
				}
			});

			it('handles partial validation failures in arrays', () => {
				const mixedArray = {
					items: [
						{ id: 1, title: 'Valid Track', artists: [{ name: 'Artist' }] },
						{ id: 'invalid', title: 123 }, // Invalid track
						{ id: 3, title: 'Another Valid Track', artists: [{ name: 'Artist' }] }
					],
					totalNumberOfItems: 3,
					limit: 20,
					offset: 0
				};

				const result = safeValidateApiResponse(mixedArray, TrackSearchResponseSchema);
				expect(result.success).toBe(false); // Should fail due to invalid track in array
			});
		});
	});
});
