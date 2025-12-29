import { describe, it, expect } from 'vitest';
import {
	isValidEmail,
	isValidUrl,
	isRequired,
	hasValidLength,
	isInRange,
	combineValidations,
	isValidTidalUrl,
	isValidSearchQuery
} from '../../test-utils/validation';

describe('Validation Utils', () => {
	describe('isValidEmail', () => {
		it('validates valid email', () => {
			expect(isValidEmail('test@example.com')).toEqual({ isValid: true });
		});

		it('rejects empty email', () => {
			expect(isValidEmail('')).toEqual({ isValid: false, message: 'Email is required' });
		});

		it('rejects whitespace only', () => {
			expect(isValidEmail('   ')).toEqual({ isValid: false, message: 'Email is required' });
		});

		it('rejects invalid format', () => {
			expect(isValidEmail('invalid')).toEqual({
				isValid: false,
				message: 'Please enter a valid email address'
			});
		});
	});

	describe('isValidUrl', () => {
		it('validates valid URL', () => {
			expect(isValidUrl('https://example.com')).toEqual({ isValid: true });
		});

		it('rejects invalid URL', () => {
			expect(isValidUrl('not-a-url')).toEqual({
				isValid: false,
				message: 'Please enter a valid URL'
			});
		});
	});

	describe('isRequired', () => {
		it('validates non-empty string', () => {
			expect(isRequired('test')).toEqual({ isValid: true });
		});

		it('rejects empty string', () => {
			expect(isRequired('')).toEqual({ isValid: false, message: 'Field is required' });
		});

		it('rejects whitespace only', () => {
			expect(isRequired('   ')).toEqual({ isValid: false, message: 'Field is required' });
		});

		it('uses custom field name', () => {
			expect(isRequired('', 'Name')).toEqual({ isValid: false, message: 'Name is required' });
		});
	});

	describe('hasValidLength', () => {
		it('validates length within range', () => {
			expect(hasValidLength('test', 1, 10)).toEqual({ isValid: true });
		});

		it('rejects too short', () => {
			expect(hasValidLength('a', 2, 10)).toEqual({
				isValid: false,
				message: 'Field must be at least 2 characters'
			});
		});

		it('rejects too long', () => {
			expect(hasValidLength('very long string', 1, 5)).toEqual({
				isValid: false,
				message: 'Field must be no more than 5 characters'
			});
		});
	});

	describe('isInRange', () => {
		it('validates number in range', () => {
			expect(isInRange(5, 1, 10)).toEqual({ isValid: true });
		});

		it('rejects too low', () => {
			expect(isInRange(0, 1, 10)).toEqual({ isValid: false, message: 'Field must be at least 1' });
		});

		it('rejects too high', () => {
			expect(isInRange(15, 1, 10)).toEqual({
				isValid: false,
				message: 'Field must be no more than 10'
			});
		});
	});

	describe('combineValidations', () => {
		it('returns valid if all valid', () => {
			expect(combineValidations({ isValid: true }, { isValid: true })).toEqual({ isValid: true });
		});

		it('returns first invalid', () => {
			const invalid = { isValid: false, message: 'Error' };
			expect(combineValidations({ isValid: true }, invalid)).toEqual(invalid);
		});
	});

	describe('isValidTidalUrl', () => {
		it('validates Tidal URL', () => {
			expect(isValidTidalUrl('https://tidal.com/album/123')).toEqual({ isValid: true });
		});

		it('rejects non-Tidal URL', () => {
			expect(isValidTidalUrl('https://spotify.com')).toEqual({
				isValid: false,
				message: 'URL must be from Tidal'
			});
		});

		it('rejects invalid URL', () => {
			expect(isValidTidalUrl('tidal.com')).toEqual({
				isValid: false,
				message: 'Please enter a valid URL'
			});
		});
	});

	describe('isValidSearchQuery', () => {
		it('validates valid query', () => {
			expect(isValidSearchQuery('test query')).toEqual({ isValid: true });
		});

		it('rejects empty query', () => {
			expect(isValidSearchQuery('')).toEqual({
				isValid: false,
				message: 'Search query is required'
			});
		});

		it('rejects too long query', () => {
			const longQuery = 'a'.repeat(201);
			expect(isValidSearchQuery(longQuery)).toEqual({
				isValid: false,
				message: 'Search query must be no more than 200 characters'
			});
		});
	});
});
