import { describe, expect, it } from 'vitest';
import { assertCompleteResponseBody } from './responseIntegrity';

function mockResponse(options: {
	status: number;
	headers?: Record<string, string>;
}): Response {
	const headerMap = new Map<string, string>();
	for (const [key, value] of Object.entries(options.headers ?? {})) {
		headerMap.set(key.toLowerCase(), value);
	}
	return {
		status: options.status,
		ok: options.status >= 200 && options.status < 300,
		headers: {
			get: (name: string) => headerMap.get(name.toLowerCase()) ?? null
		} as Headers
	} as Response;
}

describe('assertCompleteResponseBody', () => {
	it('passes when content-length matches received bytes', () => {
		const response = mockResponse({
			status: 200,
			headers: {
				'Content-Length': '1024'
			}
		});
		expect(() => assertCompleteResponseBody(response, 1024, 'audio')).not.toThrow();
	});

	it('throws when content-length does not match received bytes', () => {
		const response = mockResponse({
			status: 200,
			headers: {
				'Content-Length': '2048'
			}
		});
		expect(() => assertCompleteResponseBody(response, 1024, 'audio')).toThrow(/length mismatch/i);
	});

	it('passes for full-entity 206 responses', () => {
		const response = mockResponse({
			status: 206,
			headers: {
				'Content-Length': '10',
				'Content-Range': 'bytes 0-9/10'
			}
		});
		expect(() => assertCompleteResponseBody(response, 10, 'audio')).not.toThrow();
	});

	it('throws for partial 206 ranges', () => {
		const response = mockResponse({
			status: 206,
			headers: {
				'Content-Length': '10',
				'Content-Range': 'bytes 0-9/100'
			}
		});
		expect(() => assertCompleteResponseBody(response, 10, 'audio')).toThrow(/incomplete/i);
	});

	it('throws when 206 has unknown total size', () => {
		const response = mockResponse({
			status: 206,
			headers: {
				'Content-Length': '10',
				'Content-Range': 'bytes 0-9/*'
			}
		});
		expect(() => assertCompleteResponseBody(response, 10, 'audio')).toThrow(/unknown/i);
	});
});

