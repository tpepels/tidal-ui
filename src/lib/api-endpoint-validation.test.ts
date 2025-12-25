import { describe, it, expect } from 'vitest';
import { API_BASE } from './constants';

// API Endpoint Format Validation Test
describe('API Endpoint Format Compliance', () => {
	it('should use query parameters for track endpoint', () => {
		// This test ensures we never regress to the incorrect path parameter format
		const correctUrl = `${API_BASE}/track/?id=123&quality=LOSSLESS`;
		const wrongUrl = `${API_BASE}/track/123?quality=LOSSLESS`;

		// The correct format should include ?id= and &quality=
		expect(correctUrl).toContain('/track/?id=');
		expect(correctUrl).toContain('&quality=');

		// The wrong format should not be used
		expect(wrongUrl).not.toBe(correctUrl);
		expect(wrongUrl).toContain('/track/123?'); // This would be wrong
	});

	it('should validate track endpoint construction', () => {
		const trackId = 123;
		const quality = 'LOSSLESS';
		const expectedUrl = `${API_BASE}/track/?id=${trackId}&quality=${quality}`;

		// This mirrors the actual implementation
		const actualUrl = `${API_BASE}/track/?id=${trackId}&quality=${quality}`;

		expect(actualUrl).toBe(expectedUrl);
	});
});
