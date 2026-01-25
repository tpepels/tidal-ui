export type MappedDownloadErrorCode =
	| 'DOWNLOAD_CANCELLED'
	| 'NETWORK_ERROR'
	| 'STORAGE_ERROR'
	| 'CONVERSION_ERROR'
	| 'SERVER_ERROR'
	| 'UNKNOWN_ERROR';

export interface MappedDownloadError {
	code: MappedDownloadErrorCode;
	retry: boolean;
	message: string;
	userMessage: string;
	originalError?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const getMessage = (error: unknown): string => {
	if (typeof error === 'string') return error;
	if (error instanceof Error && error.message) return error.message;
	if (isRecord(error)) {
		const direct = error.message;
		if (typeof direct === 'string') return direct;
		const nested = error.error;
		if (typeof nested === 'string') return nested;
		if (isRecord(nested) && typeof nested.message === 'string') return nested.message;
	}
	return 'Unknown download error';
};

export const mapDownloadError = (error: unknown): MappedDownloadError => {
	if (error instanceof DOMException && error.name === 'AbortError') {
		return {
			code: 'DOWNLOAD_CANCELLED',
			retry: false,
			message: 'Download was cancelled',
			userMessage: 'Download cancelled',
			originalError: error
		};
	}

	const message = getMessage(error);
	const normalized = message.toLowerCase();

	if (normalized.includes('network') || normalized.includes('fetch') || normalized.includes('connection')) {
		return {
			code: 'NETWORK_ERROR',
			retry: true,
			message,
			userMessage: 'Network error while downloading. Please try again.',
			originalError: error
		};
	}

	if (normalized.includes('storage') || normalized.includes('disk') || normalized.includes('quota')) {
		return {
			code: 'STORAGE_ERROR',
			retry: true,
			message,
			userMessage: 'Storage error while saving the file. Please check available space.',
			originalError: error
		};
	}

	if (normalized.includes('conversion') || normalized.includes('ffmpeg') || normalized.includes('codec')) {
		return {
			code: 'CONVERSION_ERROR',
			retry: false,
			message,
			userMessage: 'Conversion failed for this track. Please try a different format.',
			originalError: error
		};
	}

	if (normalized.includes('server') || normalized.includes('http') || normalized.includes('upload')) {
		return {
			code: 'SERVER_ERROR',
			retry: true,
			message,
			userMessage: 'Server error while saving the download. Please try again.',
			originalError: error
		};
	}

	return {
		code: 'UNKNOWN_ERROR',
		retry: false,
		message,
		userMessage: 'Unexpected download error. Please try again.',
		originalError: error
	};
};
