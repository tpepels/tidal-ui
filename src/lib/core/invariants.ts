// Core invariants and validation system for system stability
export class InvariantViolationError extends Error {
	public readonly context?: unknown;
	public readonly timestamp: Date;

	constructor(message: string, context?: unknown) {
		super(`Invariant violation: ${message}`);
		this.name = 'InvariantViolationError';
		this.context = context;
		this.timestamp = new Date();
	}
}

/**
 * Asserts an invariant condition in development builds.
 * Throws InvariantViolationError if condition is false.
 */
export function assertInvariant(
	condition: boolean,
	message: string,
	context?: unknown
): asserts condition {
	if (import.meta.env.DEV && !condition) {
		throw new InvariantViolationError(message, context);
	}
}

/**
 * Validates a condition and logs warnings in production.
 * Use for invariants that shouldn't crash but should be monitored.
 */
export function validateInvariant(condition: boolean, message: string, context?: unknown): boolean {
	if (!condition) {
		console.warn(`Invariant warning: ${message}`, context);
		// TODO: Send to telemetry service
		return false;
	}
	return true;
}

/**
 * Wraps async operations with invariant checking.
 * Useful for ensuring system state consistency after operations.
 */
export async function withInvariantCheck<T>(
	operation: () => Promise<T>,
	invariantCheck: () => boolean,
	errorMessage: string
): Promise<T> {
	const result = await operation();
	assertInvariant(invariantCheck(), errorMessage, { operation: operation.name });
	return result;
}
