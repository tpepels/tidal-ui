import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { losslessAPI } from './api';
import { TidalError } from './errors';

describe('API Integration Tests', () => {
	let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

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
