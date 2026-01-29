import { describe, it, expect, vi, beforeEach } from 'vitest';
import { saveToStorage, loadFromStorage, debouncedSave } from './persistence';

// Mock localStorage
const localStorageMock = {
	getItem: vi.fn(),
	setItem: vi.fn(),
	removeItem: vi.fn(),
	clear: vi.fn()
};

Object.defineProperty(global, 'localStorage', {
	value: localStorageMock,
	writable: true
});

const sessionStorageMock = {
	getItem: vi.fn(() => 'session-test'),
	setItem: vi.fn(),
	removeItem: vi.fn(),
	clear: vi.fn()
};

Object.defineProperty(global, 'sessionStorage', {
	value: sessionStorageMock,
	writable: true
});

// Mock browser
vi.mock('$app/environment', () => ({
	browser: true
}));

describe('Persistence Utils', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('saveToStorage', () => {
		it('saves data to localStorage', () => {
			const data = { test: 'value' };
			saveToStorage('testKey', data);

			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'tidal-ui:session-test:testKey',
				expect.stringContaining('"version":1')
			);
			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'tidal-ui:session-test:testKey',
				expect.stringContaining('"data":{"test":"value"}')
			);
		});

		it('handles storage errors', () => {
			localStorageMock.setItem.mockImplementation(() => {
				throw new Error('Storage full');
			});

			// Should not throw
			expect(() => saveToStorage('testKey', {})).not.toThrow();
		});
	});

	describe('loadFromStorage', () => {
		it('loads valid data from localStorage', () => {
			const storedData = {
				version: 1,
				timestamp: Date.now(),
				data: { loaded: 'data' }
			};
			localStorageMock.getItem.mockReturnValue(JSON.stringify(storedData));

			const result = loadFromStorage('testKey', 'default');

			expect(result).toEqual({ loaded: 'data' });
		});

		it('returns default value when no data stored', () => {
			localStorageMock.getItem.mockReturnValue(null);

			const result = loadFromStorage('testKey', 'default');

			expect(result).toBe('default');
		});

		it('returns default value on version mismatch', () => {
			const storedData = {
				version: 2,
				timestamp: Date.now(),
				data: { old: 'version' }
			};
			localStorageMock.getItem.mockReturnValue(JSON.stringify(storedData));

			const result = loadFromStorage('testKey', 'default');

			expect(result).toBe('default');
		});

		it('returns default value on invalid timestamp', () => {
			const storedData = {
				version: 1,
				timestamp: Date.now() + 31 * 24 * 60 * 60 * 1000, // 31 days future
				data: { future: 'data' }
			};
			localStorageMock.getItem.mockReturnValue(JSON.stringify(storedData));

			const result = loadFromStorage('testKey', 'default');

			expect(result).toBe('default');
		});

		it('returns default value on invalid data', () => {
			const storedData = {
				version: 1,
				timestamp: Date.now(),
				data: null
			};
			localStorageMock.getItem.mockReturnValue(JSON.stringify(storedData));

			const result = loadFromStorage('testKey', 'default');

			expect(result).toBe('default');
		});

		it('handles JSON parse errors', () => {
			localStorageMock.getItem.mockReturnValue('invalid json');

			const result = loadFromStorage('testKey', 'default');

			expect(result).toBe('default');
		});
	});

	describe('debouncedSave', () => {
		it('debounces save calls', async () => {
			vi.useFakeTimers();

			debouncedSave('testKey', { data: 'value' }, 100);
			debouncedSave('testKey', { data: 'updated' }, 100);

			expect(localStorageMock.setItem).not.toHaveBeenCalled();

			vi.advanceTimersByTime(100);

			expect(localStorageMock.setItem).toHaveBeenCalledTimes(1);
			expect(localStorageMock.setItem).toHaveBeenCalledWith(
				'tidal-ui:session-test:testKey',
				expect.stringContaining('"data":{"data":"updated"}')
			);

			vi.useRealTimers();
		});
	});
});
