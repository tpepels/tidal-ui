import { describe, it, expect } from 'vitest';
import { TidalError } from './errors';

describe('TidalError', () => {
	describe('constructor', () => {
		it('creates error with all properties', () => {
			const error = new TidalError('Test message', 'TEST_CODE', 400, true);

			expect(error.message).toBe('Test message');
			expect(error.name).toBe('TidalError');
			expect(error.code).toBe('TEST_CODE');
			expect(error.statusCode).toBe(400);
			expect(error.isRetryable).toBe(true);
		});

		it('creates error with minimal properties', () => {
			const error = new TidalError('Test message');

			expect(error.message).toBe('Test message');
			expect(error.name).toBe('TidalError');
			expect(error.code).toBeUndefined();
			expect(error.statusCode).toBeUndefined();
			expect(error.isRetryable).toBe(false);
		});
	});

	describe('fromApiResponse', () => {
		it('handles rate limit error (429)', () => {
			const response = { status: 429 };
			const error = TidalError.fromApiResponse(response);

			expect(error.message).toContain('Too Many Requests');
			expect(error.code).toBe('RATE_LIMIT');
			expect(error.statusCode).toBe(429);
			expect(error.isRetryable).toBe(true);
		});

		it('handles not found error (404)', () => {
			const response = { status: 404 };
			const error = TidalError.fromApiResponse(response);

			expect(error.message).toContain('not found');
			expect(error.code).toBe('NOT_FOUND');
			expect(error.statusCode).toBe(404);
			expect(error.isRetryable).toBe(false);
		});

		it('handles server error (5xx)', () => {
			const response = { status: 500 };
			const error = TidalError.fromApiResponse(response);

			expect(error.code).toBe('SERVER_ERROR');
			expect(error.statusCode).toBe(500);
			expect(error.isRetryable).toBe(true);
		});

		it('handles client error (4xx non-404)', () => {
			const response = { status: 400, message: 'Bad Request' };
			const error = TidalError.fromApiResponse(response);

			expect(error.message).toBe('Bad Request');
			expect(error.statusCode).toBe(400);
			expect(error.isRetryable).toBe(false);
		});

		it('uses userMessage over message', () => {
			const response = {
				status: 400,
				message: 'Technical message',
				userMessage: 'User friendly message'
			};
			const error = TidalError.fromApiResponse(response);

			expect(error.message).toBe('User friendly message');
		});

		it('uses subStatus as code', () => {
			const response = { status: 400, subStatus: 123 };
			const error = TidalError.fromApiResponse(response);

			expect(error.code).toBe('123');
		});

		it('handles null/undefined response', () => {
			const error = TidalError.fromApiResponse(
				null as unknown as Parameters<typeof TidalError.fromApiResponse>[0]
			);

			expect(error.message).toContain('API error');
			expect(error.isRetryable).toBe(false);
		});
	});

	describe('networkError', () => {
		it('creates network error with original message', () => {
			const originalError = new Error('Connection failed');
			const error = TidalError.networkError(originalError);

			expect(error.message).toBe('Connection failed');
			expect(error.code).toBe('NETWORK_ERROR');
			expect(error.isRetryable).toBe(true);
		});

		it('creates network error with default message', () => {
			const error = TidalError.networkError();

			expect(error.message).toContain('Network error');
			expect(error.code).toBe('NETWORK_ERROR');
			expect(error.isRetryable).toBe(true);
		});
	});

	describe('validationError', () => {
		it('creates validation error', () => {
			const error = TidalError.validationError('Invalid input');

			expect(error.message).toBe('Invalid input');
			expect(error.code).toBe('VALIDATION_ERROR');
			expect(error.statusCode).toBe(400);
			expect(error.isRetryable).toBe(false);
		});
	});
});
