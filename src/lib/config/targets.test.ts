import { describe, expect, it } from 'vitest';
import { API_CONFIG } from './targets';

describe('API_CONFIG', () => {
	it('exports a non-empty target list with a baseUrl', () => {
		expect(API_CONFIG.targets.length).toBeGreaterThan(0);
		expect(API_CONFIG.baseUrl).toBe(API_CONFIG.targets[0].baseUrl);
	});
});
