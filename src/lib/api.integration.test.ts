import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';
import { losslessAPI } from './api';
import { TidalError } from './errors';

describe('API Integration Tests', () => {
	let consoleErrorSpy: MockInstance;

	beforeEach(() => {
		consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		consoleErrorSpy.mockRestore();
	});

	describe('LosslessAPI error handling', () => {
		it('throws error for invalid URLs', async () => {
			await expect(losslessAPI.importFromUrl('test-url')).rejects.toThrow();
			await expect(losslessAPI.importFromUrl('')).rejects.toThrow();
		});

		it('handles API errors gracefully', async () => {
			// These methods are implemented but may fail due to network/API issues
			await expect(losslessAPI.getDashManifest(123)).rejects.toThrow();
			await expect(losslessAPI.getDashManifestWithMetadata(123)).rejects.toThrow();
		});

		it('returns proper error types', async () => {
			try {
				await losslessAPI.importFromUrl('invalid-url');
				expect.fail('Should have thrown');
			} catch (error) {
				expect(error).toBeInstanceOf(Error);
			}
		});
	});

	describe('getRecommendations', () => {
		it('returns a Track array on success', async () => {
			const mockTracks = [
				{ id: 1, title: 'Track 1', artists: [] },
				{ id: 2, title: 'Track 2', artists: [] }
			];
			const mockResponse = {
				version: '2.0',
				data: {
					limit: 10,
					offset: 0,
					totalNumberOfItems: 2,
					items: mockTracks.map((track) => ({ track, sources: ['TRACK_RADIO'] }))
				}
			};

			vi.spyOn(losslessAPI as any, 'fetch').mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => mockResponse
			} as Response);

			const result = await losslessAPI.getRecommendations(123);
			expect(result).toHaveLength(2);
			expect(result[0].id).toBe(1);
			expect(result[1].id).toBe(2);
		});

		it('throws when response is not ok', async () => {
			vi.spyOn(losslessAPI as any, 'fetch').mockResolvedValueOnce({
				ok: false,
				status: 404,
				headers: new Headers()
			} as Response);

			await expect(losslessAPI.getRecommendations(123)).rejects.toThrow(
				'Failed to fetch track recommendations'
			);
		});

		it('throws when items are missing from response', async () => {
			vi.spyOn(losslessAPI as any, 'fetch').mockResolvedValueOnce({
				ok: true,
				status: 200,
				json: async () => ({ version: '2.0', data: { limit: 10, offset: 0, totalNumberOfItems: 0 } })
			} as Response);

			await expect(losslessAPI.getRecommendations(123)).rejects.toThrow('No recommendations found');
		});
	});

	describe('Error handling edge cases', () => {
		it('handles network errors gracefully', () => {
			const error = TidalError.networkError(new Error('Connection timeout'));
			expect(error.isRetryable).toBe(true);
			expect(error.code).toBe('NETWORK_ERROR');
		});

		it('handles validation errors', () => {
			const error = TidalError.validationError('Invalid quality');
			expect(error.statusCode).toBe(400);
			expect(error.isRetryable).toBe(false);
		});
	});
});
