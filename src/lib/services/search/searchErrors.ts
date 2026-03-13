import type { SearchError } from './searchTypes';

export function classifySearchError(error: unknown): SearchError {
	if (error instanceof Error) {
		const message = error.message.toLowerCase();

		if (message.includes('network') || message.includes('fetch') || message.includes('connection')) {
			return { code: 'NETWORK_ERROR', retry: true, message: error.message, originalError: error };
		}

		if (message.includes('timeout') || message.includes('timed out')) {
			return { code: 'TIMEOUT', retry: true, message: error.message };
		}

		if ('status' in error && typeof error.status === 'number') {
			if (error.status >= 500) {
				return {
					code: 'API_ERROR',
					retry: true,
					message: error.message,
					statusCode: error.status
				};
			}
			return { code: 'UNKNOWN_ERROR', retry: false, message: error.message, originalError: error };
		}

		return { code: 'UNKNOWN_ERROR', retry: false, message: error.message, originalError: error };
	}

	return {
		code: 'UNKNOWN_ERROR',
		retry: false,
		message: typeof error === 'string' ? error : 'An unknown error occurred',
		originalError: error
	};
}

export async function fetchWithRetry<T>(
	action: () => Promise<T>,
	attempts = 3,
	delayMs = 250
): Promise<T> {
	let lastError: unknown = null;

	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		try {
			return await action();
		} catch (error) {
			lastError = error;
			if (attempt < attempts) {
				await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
			}
		}
	}

	throw lastError instanceof Error ? lastError : new Error('Request failed');
}
