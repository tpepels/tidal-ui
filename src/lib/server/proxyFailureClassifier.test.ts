import { describe, expect, it } from 'vitest';
import { isAbortLikeError, isUpstreamFailureError } from './proxyFailureClassifier';

describe('proxyFailureClassifier', () => {
	it('recognizes abort-like errors', () => {
		const abortError = new DOMException('aborted', 'AbortError');
		expect(isAbortLikeError(abortError)).toBe(true);
		expect(isUpstreamFailureError(abortError)).toBe(false);
	});

	it('recognizes upstream network failures via error code', () => {
		const error = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
		expect(isUpstreamFailureError(error)).toBe(true);
	});

	it('recognizes nested upstream network failures from fetch errors', () => {
		const error = new TypeError('fetch failed');
		Object.assign(error, {
			cause: Object.assign(new Error('headers timeout'), { code: 'UND_ERR_HEADERS_TIMEOUT' })
		});
		expect(isUpstreamFailureError(error)).toBe(true);
	});

	it('does not classify generic local errors as upstream failures', () => {
		expect(isUpstreamFailureError(new Error('failed to decode cached payload'))).toBe(false);
	});
});
