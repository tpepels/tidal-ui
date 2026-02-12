const UPSTREAM_NETWORK_ERROR_CODES = new Set([
	'ECONNREFUSED',
	'ECONNRESET',
	'ENOTFOUND',
	'EAI_AGAIN',
	'ETIMEDOUT',
	'ECONNABORTED',
	'UND_ERR_CONNECT_TIMEOUT',
	'UND_ERR_CONNECT_ABORTED',
	'UND_ERR_HEADERS_TIMEOUT',
	'UND_ERR_SOCKET'
]);

function readErrorCode(error: unknown): string | null {
	if (!error || typeof error !== 'object') {
		return null;
	}
	const code = (error as { code?: unknown }).code;
	return typeof code === 'string' ? code : null;
}

function readErrorCause(error: unknown): unknown {
	if (!error || typeof error !== 'object') {
		return null;
	}
	return (error as { cause?: unknown }).cause;
}

function hasUpstreamNetworkCode(error: unknown, depth = 0): boolean {
	if (!error || depth > 4) {
		return false;
	}

	const code = readErrorCode(error);
	if (code && UPSTREAM_NETWORK_ERROR_CODES.has(code)) {
		return true;
	}

	const cause = readErrorCause(error);
	if (!cause || cause === error) {
		return false;
	}

	return hasUpstreamNetworkCode(cause, depth + 1);
}

export function isAbortLikeError(error: unknown): boolean {
	return (
		(error instanceof DOMException && error.name === 'AbortError') ||
		(typeof error === 'object' &&
			error !== null &&
			'name' in error &&
			(error as { name?: unknown }).name === 'AbortError')
	);
}

export function isUpstreamFailureError(error: unknown): boolean {
	if (isAbortLikeError(error)) {
		return false;
	}

	if (hasUpstreamNetworkCode(error)) {
		return true;
	}

	if (error instanceof TypeError) {
		const message = error.message.toLowerCase();
		if (
			message.includes('fetch failed') ||
			message.includes('network') ||
			message.includes('timed out')
		) {
			return true;
		}
	}

	return false;
}
