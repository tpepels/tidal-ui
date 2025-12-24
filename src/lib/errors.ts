import { ERROR_MESSAGES } from './constants';

export class TidalError extends Error {
	public readonly code?: string;
	public readonly statusCode?: number;
	public readonly isRetryable: boolean;

	constructor(message: string, code?: string, statusCode?: number, isRetryable = false) {
		super(message);
		this.name = 'TidalError';
		this.code = code;
		this.statusCode = statusCode;
		this.isRetryable = isRetryable;
	}

	static fromApiResponse(response: {
		status?: number;
		statusText?: string;
		userMessage?: string;
		message?: string;
		subStatus?: number;
	}): TidalError {
		if (response?.status === 429) {
			return new TidalError(ERROR_MESSAGES.RATE_LIMIT_ERROR, 'RATE_LIMIT', 429, true);
		}

		if (response?.status === 404) {
			return new TidalError(ERROR_MESSAGES.TRACK_NOT_FOUND, 'NOT_FOUND', 404, false);
		}

		if (response?.status && response.status >= 500) {
			return new TidalError(ERROR_MESSAGES.API_ERROR, 'SERVER_ERROR', response.status, true);
		}

		const message = response?.userMessage || response?.message || ERROR_MESSAGES.API_ERROR;
		return new TidalError(message, response?.subStatus?.toString(), response?.status, false);
	}

	static networkError(originalError?: Error): TidalError {
		return new TidalError(
			originalError?.message || ERROR_MESSAGES.NETWORK_ERROR,
			'NETWORK_ERROR',
			undefined,
			true
		);
	}

	static validationError(message: string): TidalError {
		return new TidalError(message, 'VALIDATION_ERROR', 400, false);
	}
}

export class ValidationError extends TidalError {
	constructor(message: string) {
		super(message, 'VALIDATION_ERROR', 400, false);
		this.name = 'ValidationError';
	}
}

export class NetworkError extends TidalError {
	constructor(message: string = ERROR_MESSAGES.NETWORK_ERROR) {
		super(message, 'NETWORK_ERROR', undefined, true);
		this.name = 'NetworkError';
	}
}

export class NotFoundError extends TidalError {
	constructor(resource: string) {
		super(`${resource} not found`, 'NOT_FOUND', 404, false);
		this.name = 'NotFoundError';
	}
}

// Error boundary utility
export function withErrorHandling<R>(fn: () => Promise<R>, context: string): Promise<R> {
	return (async (): Promise<R> => {
		try {
			return await fn();
		} catch (error) {
			console.error(`Error in ${context}:`, error);

			if (error instanceof TidalError) {
				throw error;
			}

			if (error instanceof TypeError && error.message.includes('fetch')) {
				throw NetworkError.networkError(error as Error);
			}

			throw new TidalError(
				`Unexpected error in ${context}: ${error instanceof Error ? error.message : 'Unknown error'}`,
				'UNKNOWN_ERROR',
				undefined,
				false
			);
		}
	})();
}

// Robust fetch with retry, timeout, and error handling
export async function retryFetch(
	url: string,
	options: RequestInit & { timeout?: number; maxRetries?: number } = {}
): Promise<Response> {
	const { timeout = 10000, maxRetries = 3, ...fetchOptions } = options;

	return retryWithBackoff(
		async () => {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), timeout);

			try {
				const response = await fetch(url, {
					...fetchOptions,
					signal: controller.signal
				});
				clearTimeout(timeoutId);

				// Handle rate limiting
				if (response?.status === 429) {
					throw TidalError.fromApiResponse({ status: 429, statusText: 'Too Many Requests' });
				}

				// Throw for server errors to retry
				if (response.status >= 500) {
					throw TidalError.fromApiResponse({
						status: response.status,
						statusText: response.statusText
					});
				}

				return response;
			} catch (error) {
				clearTimeout(timeoutId);

				// Handle abort/timeout
				if (error instanceof DOMException && error.name === 'AbortError') {
					throw TidalError.networkError(new Error('Request timeout'));
				}

				// Handle network errors
				if (error instanceof TypeError && error.message.includes('fetch')) {
					throw TidalError.networkError(error as Error);
				}

				throw error;
			}
		},
		maxRetries,
		1000,
		(error) => {
			// Retry on network errors, timeouts, or server errors
			return (
				error instanceof TidalError &&
				(error.code === 'NETWORK_ERROR' ||
					error.code === 'SERVER_ERROR' ||
					error.statusCode === 429)
			);
		}
	);
}

// Retry utility with exponential backoff
export async function retryWithBackoff<T>(
	operation: () => Promise<T>,
	maxRetries = 3,
	baseDelay = 1000,
	shouldRetry?: (error: unknown) => boolean
): Promise<T> {
	let lastError: unknown;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await operation();
		} catch (error) {
			lastError = error;

			// Don't retry on the last attempt or if error is not retryable
			if (attempt === maxRetries || !(error instanceof TidalError && error.isRetryable)) {
				break;
			}

			// Check custom retry condition
			if (shouldRetry && !shouldRetry(error)) {
				break;
			}

			// Exponential backoff with jitter
			const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
			await new Promise((resolve) => setTimeout(resolve, delay));
		}
	}

	throw lastError;
}
