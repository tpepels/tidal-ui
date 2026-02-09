/**
 * Per-target API rate limiter with exponential backoff
 * Tracks request rates and enforces limits per upstream API target
 */

interface RateLimitState {
	requestCount: number;
	windowStart: number;
	consecutiveErrors: number;
	lastErrorTime: number;
	backoffUntil: number;
}

const rateLimits = new Map<string, RateLimitState>();

// Configuration
const REQUESTS_PER_MINUTE = 60;
const WINDOW_SIZE_MS = 60000;
const MAX_CONSECUTIVE_ERRORS = 5;
const INITIAL_BACKOFF_MS = 5000;
const MAX_BACKOFF_MS = 300000; // 5 minutes

/**
 * Check if a request is allowed for a target
 */
export function isRequestAllowed(target: string): boolean {
	const state = rateLimits.get(target);
	const now = Date.now();
	
	if (!state) {
		// Initialize new target
		rateLimits.set(target, {
			requestCount: 0,
			windowStart: now,
			consecutiveErrors: 0,
			lastErrorTime: 0,
			backoffUntil: 0
		});
		return true;
	}
	
	// Check if in backoff period (exponential backoff on errors)
	if (state.backoffUntil > now) {
		return false;
	}
	
	// Reset window if expired
	const timeSinceWindowStart = now - state.windowStart;
	if (timeSinceWindowStart > WINDOW_SIZE_MS) {
		state.requestCount = 0;
		state.windowStart = now;
		state.consecutiveErrors = 0;
	}
	
	// Check rate limit
	return state.requestCount < REQUESTS_PER_MINUTE;
}

/**
 * Record a successful request
 */
export function recordSuccess(target: string): void {
	const state = rateLimits.get(target);
	if (!state) return;
	
	const now = Date.now();
	
	// Reset window if expired
	if (now - state.windowStart > WINDOW_SIZE_MS) {
		state.requestCount = 0;
		state.windowStart = now;
	}
	
	state.requestCount++;
	state.consecutiveErrors = 0; // Reset error counter
	state.backoffUntil = 0; // Clear backoff
}

/**
 * Record a failed request, apply exponential backoff
 */
export function recordError(
	target: string,
	errorType: 'rate_limit' | 'network' | 'server_error' | 'other' = 'other'
): { backoffMs: number; shouldRetry: boolean } {
	const state = rateLimits.get(target);
	if (!state) return { backoffMs: 0, shouldRetry: false };
	
	const now = Date.now();
	state.lastErrorTime = now;
	state.consecutiveErrors++;
	
	// Calculate backoff time (exponential with cap)
	let backoffMs = INITIAL_BACKOFF_MS;
	
	// Special handling for rate limit errors
	if (errorType === 'rate_limit') {
		backoffMs = 60000; // Always wait a minute for rate limits
	} else {
		// Exponential backoff: 5s, 10s, 20s, 40s, ... up to 5min
		backoffMs = INITIAL_BACKOFF_MS * Math.pow(2, Math.min(state.consecutiveErrors - 1, 6));
		backoffMs = Math.min(backoffMs, MAX_BACKOFF_MS);
	}
	
	state.backoffUntil = now + backoffMs;
	
	// Don't retry if too many consecutive errors
	const shouldRetry = state.consecutiveErrors <= MAX_CONSECUTIVE_ERRORS;
	
	if (!shouldRetry) {
		console.warn(`[RateLimit] Target ${target} exceeded max consecutive errors (${state.consecutiveErrors})`);
	}
	
	return { backoffMs, shouldRetry };
}

/**
 * Get current rate limit status for a target
 */
export function getStatus(target: string): {
	isAllowed: boolean;
	requestCount: number;
	requestsPerMinute: number;
	windowRemainingMs: number;
	consecutiveErrors: number;
	inBackoff: boolean;
	backoffRemainingMs: number;
} {
	const state = rateLimits.get(target);
	const now = Date.now();
	
	if (!state) {
		return {
			isAllowed: true,
			requestCount: 0,
			requestsPerMinute: REQUESTS_PER_MINUTE,
			windowRemainingMs: WINDOW_SIZE_MS,
			consecutiveErrors: 0,
			inBackoff: false,
			backoffRemainingMs: 0
		};
	}
	
	const windowRemainingMs = Math.max(0, WINDOW_SIZE_MS - (now - state.windowStart));
	const backoffRemainingMs = Math.max(0, state.backoffUntil - now);
	
	return {
		isAllowed: isRequestAllowed(target),
		requestCount: state.requestCount,
		requestsPerMinute: REQUESTS_PER_MINUTE,
		windowRemainingMs,
		consecutiveErrors: state.consecutiveErrors,
		inBackoff: backoffRemainingMs > 0,
		backoffRemainingMs
	};
}

/**
 * Reset rate limit state for a target
 */
export function reset(target: string): void {
	rateLimits.delete(target);
	console.log(`[RateLimit] Reset rate limit for target: ${target}`);
}

/**
 * Get all rate limit states
 */
export function getAllStatus(): Record<string, ReturnType<typeof getStatus>> {
	const result: Record<string, ReturnType<typeof getStatus>> = {};
	for (const [target] of rateLimits) {
		result[target] = getStatus(target);
	}
	return result;
}
