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

			const result = validateApiResponse(validData, SearchResponseSchema, '/search/tracks');
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

			const result = validateApiResponse(validAlbum, AlbumResponseSchema, '/album/1');
			expect(result.album.title).toBe('Test Album');
		});
	});

	describe('validateEndpointFormat', () => {
		it('validates correct REST endpoints', () => {
			expect(validateEndpointFormat('/album/123', '/album/{id}', { id: 123 })).toBe(true);
			expect(validateEndpointFormat('/artist/456', '/artist/{id}', { id: 456 })).toBe(true);
			expect(
				validateEndpointFormat('/track/789?quality=LOSSLESS', '/track/{trackId}', { trackId: 789 })
			).toBe(true);
		});

		it('rejects incorrect endpoints', () => {
			expect(validateEndpointFormat('/album?id=123', '/album/{id}', { id: 123 })).toBe(false);
			expect(validateEndpointFormat('/search/?s=query', '/search/tracks', {})).toBe(false);
		});
	});

	describe('API Spec Compliance', () => {
		it('validates search endpoints match spec', () => {
			// These should match the OpenAPI spec exactly
			expect(API_SPECS.SEARCH_ENDPOINTS.tracks).toBe('/search/tracks');
			expect(API_SPECS.SEARCH_ENDPOINTS.albums).toBe('/search/albums');
			expect(API_SPECS.SEARCH_ENDPOINTS.artists).toBe('/search/artists');
			expect(API_SPECS.SEARCH_ENDPOINTS.playlists).toBe('/search/playlists');
		});

		it('validates resource endpoints match spec', () => {
			expect(API_SPECS.RESOURCE_ENDPOINTS.album).toBe('/album/{id}');
			expect(API_SPECS.RESOURCE_ENDPOINTS.artist).toBe('/artist/{id}');
			expect(API_SPECS.RESOURCE_ENDPOINTS.track).toBe('/track/{trackId}');
			expect(API_SPECS.RESOURCE_ENDPOINTS.trackStream).toBe('/track/{trackId}/stream');
			expect(API_SPECS.RESOURCE_ENDPOINTS.trackDash).toBe('/track/{trackId}/dash');
		});
	});

	describe('Error Handling', () => {
		it('provides detailed validation error messages', () => {
			const invalidData = { invalidField: 'value' };

			expect(() => {
				validateApiResponse(invalidData, AlbumResponseSchema, '/album/1');
			}).toThrow(/API response validation failed for \/album\/1/);
		});

		it('handles Zod errors gracefully', () => {
			const invalidData = null;

			expect(() => {
				validateApiResponse(invalidData, SearchResponseSchema, '/search/tracks');
			}).toThrow(TidalError);
		});
	});
});
