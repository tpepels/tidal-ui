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

	static fromApiResponse(response: any): TidalError {
		if (response?.status === 429) {
			return new TidalError(ERROR_MESSAGES.RATE_LIMIT_ERROR, 'RATE_LIMIT', 429, true);
		}

		if (response?.status === 404) {
			return new TidalError(ERROR_MESSAGES.TRACK_NOT_FOUND, 'NOT_FOUND', 404, false);
		}

		if (response?.status >= 500) {
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

// Retry utility with exponential backoff
export async function retryWithBackoff<T>(
	operation: () => Promise<T>,
	maxRetries = 3,
	baseDelay = 1000,
	shouldRetry?: (error: any) => boolean
): Promise<T> {
	let lastError: any;

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
