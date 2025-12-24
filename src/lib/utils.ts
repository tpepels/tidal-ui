// ============================================================================
// UTILITIES INDEX
// Re-exports from specialized utility modules
// ============================================================================

// Re-export formatters
export {
	formatArtists,
	formatArtistsForMetadata,
	formatDuration,
	formatFileSize,
	formatNumber,
	truncateText
} from './utils/formatters';

// Re-export validation utilities
export {
	isValidEmail,
	isValidUrl,
	isRequired,
	hasValidLength,
	isInRange,
	combineValidations,
	isValidTidalUrl,
	isValidSearchQuery,
	type ValidationResult
} from './utils/validation';

// Re-export cache utilities
export { apiCache, ApiCache } from './utils/cache';
