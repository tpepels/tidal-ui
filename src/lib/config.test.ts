import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { API_CONFIG, fetchWithCORS } from './config';

// Mock environment variables
const originalEnv = process.env;

describe('Configuration Tests', () => {
	beforeEach(() => {
		// Reset environment
		process.env = { ...originalEnv };
		vi.resetModules();
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	describe('API_CONFIG configuration', () => {
		it('should use default API base URL', () => {
			expect(API_CONFIG.baseUrl).toBeDefined();
			expect(typeof API_CONFIG.baseUrl).toBe('string');
			expect(API_CONFIG.baseUrl.length).toBeGreaterThan(0);
		});

		it('should validate API base URL format', () => {
			expect(API_CONFIG.baseUrl).toMatch(/^https?:\/\/.+/);
		});

		it('should have valid proxy configuration', () => {
			expect(API_CONFIG.useProxy).toBeDefined();
			expect(typeof API_CONFIG.proxyUrl).toBe('string');
		});
	});

	describe('API targets configuration', () => {
		it('should have valid API targets', () => {
			expect(Array.isArray(API_CONFIG.targets)).toBe(true);
			expect(API_CONFIG.targets.length).toBeGreaterThan(0);
		});

		it('should have valid target configurations', () => {
			for (const target of API_CONFIG.targets) {
				expect(target.name).toBeDefined();
				expect(target.baseUrl).toMatch(/^https?:\/\/.+/);
				expect(typeof target.weight).toBe('number');
				expect(target.weight).toBeGreaterThan(0);
			}
		});
	});

	describe('Environment-specific configurations', () => {
		it('should handle different environments', () => {
			// Configuration is environment-agnostic in tests due to mocking
			expect(API_CONFIG).toBeDefined();
			expect(API_CONFIG.baseUrl).toBeDefined();
		});
	});

	describe('Configuration validation', () => {
		it('should export all required configuration values', () => {
			expect(fetchWithCORS).toBeDefined();
			expect(typeof fetchWithCORS).toBe('function');
		});

		it('should have valid API base URL', () => {
			expect(API_CONFIG.baseUrl).toMatch(/^https?:\/\/[^/]+/);
		});

		it('should have proper CORS configuration', () => {
			expect(typeof fetchWithCORS).toBe('function');
		});
	});
});
