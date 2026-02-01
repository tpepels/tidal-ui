/**
 * Server-side observability module for download/upload operations.
 *
 * Provides structured logging, operation tracking, and error reporting
 * for server-side code that cannot use the browser-based logger.
 */

export enum LogLevel {
	ERROR = 0,
	WARN = 1,
	INFO = 2,
	DEBUG = 3,
	TRACE = 4
}

export interface DownloadLogContext {
	uploadId?: string;
	correlationId?: string;
	trackId?: number;
	quality?: string;
	artistName?: string;
	albumTitle?: string;
	trackTitle?: string;
	chunkIndex?: number;
	totalChunks?: number;
	progress?: number;
	bytesWritten?: number;
	totalBytes?: number;
	error?: Error | string;
	errorCode?: string;
	recoverable?: boolean;
	phase?: 'init' | 'metadata' | 'chunk' | 'finalize' | 'cleanup' | 'error';
	duration?: number;
	retryAttempt?: number;
	conflictResolution?: string;
	action?: 'overwrite' | 'skip' | 'rename';
	[key: string]: unknown;
}

export interface DownloadOperation {
	uploadId: string;
	correlationId: string;
	trackId?: number;
	artistName?: string;
	trackTitle?: string;
	quality?: string;
	startTime: number;
	events: DownloadEvent[];
	status: 'in_progress' | 'completed' | 'failed' | 'cancelled';
	finalError?: string;
	totalDuration?: number;
}

export interface DownloadEvent {
	timestamp: number;
	phase: DownloadLogContext['phase'];
	level: LogLevel;
	message: string;
	context: DownloadLogContext;
}

// In-memory store for recent operations (server-side)
const recentOperations = new Map<string, DownloadOperation>();
const MAX_OPERATIONS = 100;
const OPERATION_TTL = 30 * 60 * 1000; // 30 minutes

// Current log level (configurable via environment)
// Default to DEBUG in test environment for comprehensive event tracking
const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';
const currentLevel: LogLevel = process.env.LOG_LEVEL
	? parseInt(process.env.LOG_LEVEL, 10)
	: isTest ? LogLevel.DEBUG : LogLevel.INFO;

const shouldLog = (level: LogLevel): boolean => level <= currentLevel;

const formatTimestamp = (): string => new Date().toISOString();

const generateCorrelationId = (): string =>
	`dl-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

/**
 * Logs a message with structured context for download operations.
 */
const log = (level: LogLevel, message: string, context: DownloadLogContext = {}): void => {
	const timestamp = formatTimestamp();
	const uploadId = context.uploadId || 'unknown';
	const phase = context.phase || 'unknown';
	const correlationId = context.correlationId || uploadId;

	// Always track event in operation if exists (for observability)
	const operation = recentOperations.get(uploadId);
	if (operation) {
		operation.events.push({
			timestamp: Date.now(),
			phase: context.phase,
			level,
			message,
			context
		});
	}

	// Only output to console if log level allows
	if (!shouldLog(level)) return;

	const prefix = `[${timestamp}][Download][${correlationId}][${phase}]`;

	// Format structured log for console
	const logData = {
		timestamp,
		level: LogLevel[level],
		correlationId,
		uploadId,
		phase,
		message,
		...context
	};

	switch (level) {
		case LogLevel.ERROR:
			console.error(prefix, message, logData);
			break;
		case LogLevel.WARN:
			console.warn(prefix, message, logData);
			break;
		case LogLevel.INFO:
			console.info(prefix, message, logData);
			break;
		case LogLevel.DEBUG:
			console.debug(prefix, message, logData);
			break;
		case LogLevel.TRACE:
			console.trace(prefix, message, logData);
			break;
	}
};

/**
 * Creates a download operation tracker for a new upload session.
 * Returns a structured logger bound to this operation.
 */
export const createDownloadOperationLogger = (
	uploadId: string,
	context: Partial<DownloadLogContext> = {}
) => {
	const correlationId = context.correlationId || generateCorrelationId();
	const startTime = Date.now();

	// Create operation record
	const operation: DownloadOperation = {
		uploadId,
		correlationId,
		trackId: context.trackId,
		artistName: context.artistName,
		trackTitle: context.trackTitle,
		quality: context.quality,
		startTime,
		events: [],
		status: 'in_progress'
	};

	// Store operation
	recentOperations.set(uploadId, operation);

	// Cleanup old operations
	cleanupOldOperations();

	const baseContext: DownloadLogContext = {
		uploadId,
		correlationId,
		...context
	};

	const createLogFn =
		(level: LogLevel) =>
		(message: string, additionalContext: DownloadLogContext = {}) => {
			log(level, message, { ...baseContext, ...additionalContext });
		};

	return {
		correlationId,

		// Logging methods
		error: createLogFn(LogLevel.ERROR),
		warn: createLogFn(LogLevel.WARN),
		info: createLogFn(LogLevel.INFO),
		debug: createLogFn(LogLevel.DEBUG),
		trace: createLogFn(LogLevel.TRACE),

		// Phase tracking
		startPhase: (phase: DownloadLogContext['phase'], message?: string) => {
			log(LogLevel.DEBUG, message || `Starting ${phase} phase`, {
				...baseContext,
				phase
			});
		},

		// Chunk progress
		chunkProgress: (
			chunkIndex: number,
			totalChunks: number,
			bytesWritten?: number,
			totalBytes?: number
		) => {
			const progress = Math.round((chunkIndex / totalChunks) * 100);
			log(LogLevel.DEBUG, `Chunk ${chunkIndex + 1}/${totalChunks} (${progress}%)`, {
				...baseContext,
				phase: 'chunk',
				chunkIndex,
				totalChunks,
				progress,
				bytesWritten,
				totalBytes
			});
		},

		// Success completion
		complete: (additionalContext: DownloadLogContext = {}) => {
			const duration = Date.now() - startTime;
			operation.status = 'completed';
			operation.totalDuration = duration;

			log(LogLevel.INFO, `Download completed successfully in ${duration}ms`, {
				...baseContext,
				...additionalContext,
				phase: 'finalize',
				duration
			});
		},

		// Failure
		fail: (error: Error | string, additionalContext: DownloadLogContext = {}) => {
			const duration = Date.now() - startTime;
			operation.status = 'failed';
			operation.totalDuration = duration;
			operation.finalError = error instanceof Error ? error.message : error;

			log(LogLevel.ERROR, `Download failed: ${operation.finalError}`, {
				...baseContext,
				...additionalContext,
				phase: 'error',
				duration,
				error: error instanceof Error ? error.message : error,
				errorCode: additionalContext.errorCode
			});
		},

		// Retry tracking
		retry: (attempt: number, reason: string, additionalContext: DownloadLogContext = {}) => {
			log(LogLevel.WARN, `Retry attempt ${attempt}: ${reason}`, {
				...baseContext,
				...additionalContext,
				retryAttempt: attempt
			});
		},

		// Get operation summary
		getSummary: (): DownloadOperation => ({ ...operation })
	};
};

/**
 * Retrieves an existing operation logger by uploadId.
 * Useful for continuing logging in subsequent requests.
 */
export const getDownloadOperationLogger = (uploadId: string) => {
	const operation = recentOperations.get(uploadId);
	if (!operation) return null;

	return createDownloadOperationLogger(uploadId, {
		correlationId: operation.correlationId,
		trackId: operation.trackId,
		artistName: operation.artistName,
		trackTitle: operation.trackTitle,
		quality: operation.quality
	});
};

/**
 * Standalone logging functions for simple cases
 */
export const downloadLogger = {
	error: (message: string, context: DownloadLogContext = {}) =>
		log(LogLevel.ERROR, message, context),
	warn: (message: string, context: DownloadLogContext = {}) =>
		log(LogLevel.WARN, message, context),
	info: (message: string, context: DownloadLogContext = {}) =>
		log(LogLevel.INFO, message, context),
	debug: (message: string, context: DownloadLogContext = {}) =>
		log(LogLevel.DEBUG, message, context),
	trace: (message: string, context: DownloadLogContext = {}) =>
		log(LogLevel.TRACE, message, context)
};

/**
 * Get recent operations for debugging
 */
export const getRecentOperations = (
	options: { limit?: number; status?: DownloadOperation['status'] } = {}
): DownloadOperation[] => {
	const { limit = 50, status } = options;
	let operations = Array.from(recentOperations.values());

	if (status) {
		operations = operations.filter((op) => op.status === status);
	}

	// Sort by start time descending
	operations.sort((a, b) => b.startTime - a.startTime);

	return operations.slice(0, limit);
};

/**
 * Get operation by ID
 */
export const getOperation = (uploadId: string): DownloadOperation | null => {
	return recentOperations.get(uploadId) || null;
};

/**
 * Get summary statistics
 */
export const getDownloadStats = () => {
	const operations = Array.from(recentOperations.values());
	const now = Date.now();
	const oneHourAgo = now - 60 * 60 * 1000;

	const recentOps = operations.filter((op) => op.startTime > oneHourAgo);
	const completed = recentOps.filter((op) => op.status === 'completed');
	const failed = recentOps.filter((op) => op.status === 'failed');
	const inProgress = recentOps.filter((op) => op.status === 'in_progress');

	const durations = completed.map((op) => op.totalDuration || 0).filter((d) => d > 0);
	const avgDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

	return {
		total: recentOps.length,
		completed: completed.length,
		failed: failed.length,
		inProgress: inProgress.length,
		successRate: recentOps.length > 0 ? (completed.length / recentOps.length) * 100 : 0,
		avgDurationMs: Math.round(avgDuration),
		lastHour: {
			started: recentOps.length,
			completed: completed.length,
			failed: failed.length
		}
	};
};

/**
 * Cleanup old operations to prevent memory leaks
 */
const cleanupOldOperations = () => {
	const now = Date.now();
	const expiredIds: string[] = [];

	for (const [id, operation] of recentOperations.entries()) {
		if (now - operation.startTime > OPERATION_TTL) {
			expiredIds.push(id);
		}
	}

	for (const id of expiredIds) {
		recentOperations.delete(id);
	}

	// Also enforce max size
	if (recentOperations.size > MAX_OPERATIONS) {
		const operations = Array.from(recentOperations.entries()).sort(
			([, a], [, b]) => a.startTime - b.startTime
		);
		const toRemove = operations.slice(0, recentOperations.size - MAX_OPERATIONS);
		for (const [id] of toRemove) {
			recentOperations.delete(id);
		}
	}
};

/**
 * Clear all operations (for testing)
 */
export const clearOperations = () => {
	recentOperations.clear();
};
