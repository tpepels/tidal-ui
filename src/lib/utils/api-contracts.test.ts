import { describe, it, expect } from 'vitest';
import {
	validateApiResponse,
	SearchResponseSchema,
	AlbumResponseSchema,
	validateEndpointFormat,
	API_SPECS
} from './api-contracts';
import { TidalError } from '../errors';

describe('API Contract Validation', () => {
	describe('validateApiResponse', () => {
		it('validates correct search response', () => {
			const validData = {
				items: [{ id: 1, title: 'Test Track', artists: [{ name: 'Artist' }] }],
				total: 1,
				limit: 50,
				offset: 0
			};

			const result = validateApiResponse(validData, SearchResponseSchema, '/search/?s=query');
			expect(result).toEqual(validData);
		});

		it('throws on invalid search response', () => {
			const invalidData = {
				items: 'not an array',
				total: 'not a number'
			};

			expect(() => {
				validateApiResponse(invalidData, SearchResponseSchema, '/search/tracks');
			}).toThrow('API response validation failed');
		});

		it('validates album response', () => {
			const validAlbum = {
				album: {
					id: 1,
					title: 'Test Album',
					cover: 'cover.jpg'
				},
				tracks: [
					{
						id: 1,
						title: 'Track 1',
						duration: 180,
						trackNumber: 1,
						artists: [{ id: 1, name: 'Artist', type: 'main' }]
					}
				]
			};

			const result = validateApiResponse(validAlbum, AlbumResponseSchema, '/album/?id=1');
			expect(result.album.title).toBe('Test Album');
		});
	});

	describe('validateEndpointFormat', () => {
		it('validates correct hifi-api query endpoints', () => {
			expect(validateEndpointFormat('/album/?id=123', '/album/?id={id}', { id: 123 })).toBe(true);
			expect(validateEndpointFormat('/artist/?id=456', '/artist/?id={id}', { id: 456 })).toBe(true);
			expect(
				validateEndpointFormat('/track/?id=789&quality=LOSSLESS', '/track/?id={trackId}', { trackId: 789 })
			).toBe(true);
		});

		it('rejects incorrect endpoints', () => {
			expect(validateEndpointFormat('/album/123', '/album/?id={id}', { id: 123 })).toBe(false);
			expect(validateEndpointFormat('/search/tracks', '/search/?s={query}', { query: 'query' })).toBe(false);
		});
	});

	describe('API Spec Compliance', () => {
		it('validates search endpoints match spec', () => {
			expect(API_SPECS.VERSION).toBe('2.10');
			expect(API_SPECS.SEARCH_ENDPOINTS.tracks).toBe('/search/?s={query}');
			expect(API_SPECS.SEARCH_ENDPOINTS.albums).toBe('/search/?al={query}');
			expect(API_SPECS.SEARCH_ENDPOINTS.artists).toBe('/search/?a={query}');
			expect(API_SPECS.SEARCH_ENDPOINTS.playlists).toBe('/search/?p={query}');
			expect(API_SPECS.SEARCH_ENDPOINTS.isrc).toBe('/search/?i={isrc}');
		});

		it('validates resource endpoints match spec', () => {
			expect(API_SPECS.RESOURCE_ENDPOINTS.album).toBe('/album/?id={id}');
			expect(API_SPECS.RESOURCE_ENDPOINTS.artist).toBe('/artist/?id={id}');
			expect(API_SPECS.RESOURCE_ENDPOINTS.trackPlaybackInfo).toBe('/track/?id={trackId}');
			expect(API_SPECS.RESOURCE_ENDPOINTS.trackManifests).toBe('/trackManifests/?id={trackId}');
			expect(API_SPECS.RESOURCE_ENDPOINTS.artistSimilar).toBe('/artist/similar/?id={id}');
			expect(API_SPECS.RESOURCE_ENDPOINTS.video).toBe('/video/?id={videoId}');
		});
	});

	describe('Error Handling', () => {
		it('provides detailed validation error messages', () => {
			const invalidData = { invalidField: 'value' };

			expect(() => {
				validateApiResponse(invalidData, AlbumResponseSchema, '/album/?id=1');
			}).toThrow(/API response validation failed for \/album\/\?id=1/);
		});

		it('handles Zod errors gracefully', () => {
			const invalidData = null;

			expect(() => {
				validateApiResponse(invalidData, SearchResponseSchema, '/search/?s=query');
			}).toThrow(TidalError);
		});
	});
});
