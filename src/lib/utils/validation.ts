/**
 * Validation utilities for form inputs and data validation
 */

export interface ValidationResult {
	isValid: boolean;
	message?: string;
}

/**
 * Validates an email address format
 */
export function isValidEmail(email: string): ValidationResult {
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

	if (!email.trim()) {
		return { isValid: false, message: 'Email is required' };
	}

	if (!emailRegex.test(email)) {
		return { isValid: false, message: 'Please enter a valid email address' };
	}

	return { isValid: true };
}

/**
 * Validates a URL format
 */
export function isValidUrl(url: string): ValidationResult {
	try {
		new URL(url);
		return { isValid: true };
	} catch {
		return { isValid: false, message: 'Please enter a valid URL' };
	}
}

/**
 * Validates that a string is not empty
 */
export function isRequired(value: string, fieldName = 'Field'): ValidationResult {
	if (!value.trim()) {
		return { isValid: false, message: `${fieldName} is required` };
	}
	return { isValid: true };
}

/**
 * Validates string length
 */
export function hasValidLength(
	value: string,
	minLength = 0,
	maxLength = Infinity,
	fieldName = 'Field'
): ValidationResult {
	if (value.length < minLength) {
		return {
			isValid: false,
			message: `${fieldName} must be at least ${minLength} characters`
		};
	}

	if (value.length > maxLength) {
		return {
			isValid: false,
			message: `${fieldName} must be no more than ${maxLength} characters`
		};
	}

	return { isValid: true };
}

/**
 * Validates that a number is within a range
 */
export function isInRange(
	value: number,
	min = -Infinity,
	max = Infinity,
	fieldName = 'Field'
): ValidationResult {
	if (value < min) {
		return {
			isValid: false,
			message: `${fieldName} must be at least ${min}`
		};
	}

	if (value > max) {
		return {
			isValid: false,
			message: `${fieldName} must be no more than ${max}`
		};
	}

	return { isValid: true };
}

/**
 * Combines multiple validation results
 */
export function combineValidations(...results: ValidationResult[]): ValidationResult {
	for (const result of results) {
		if (!result.isValid) {
			return result;
		}
	}
	return { isValid: true };
}

/**
 * Validates Tidal URL patterns
 */
export function isValidTidalUrl(url: string): ValidationResult {
	const tidalUrlRegex = /tidal\.com/i;

	if (!tidalUrlRegex.test(url)) {
		return { isValid: false, message: 'URL must be from Tidal' };
	}

	return isValidUrl(url);
}

/**
 * Validates search query
 */
export function isValidSearchQuery(query: string): ValidationResult {
	const result = isRequired(query, 'Search query');
	if (!result.isValid) {
		return result;
	}

	return hasValidLength(query, 1, 200, 'Search query');
}
