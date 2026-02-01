/**
 * Client-side observability module for playback operations.
 *
 * Provides structured logging, operation tracking, and error reporting
 * for audio playback, including fallback scenarios.
 */

import { logger, type LogContext, LogLevel } from './logger';
import { trackError } from './errorTracker';
import { recordMetric } from './performance';

export type PlaybackPhase =
	| 'load_start'
	| 'loading'
	| 'load_complete'
	| 'playing'
	| 'paused'
	| 'buffering'
	| 'error'
	| 'fallback_start'
	| 'fallback_loading'
	| 'fallback_complete'
	| 'fallback_failed'
	| 'recovery';

export interface PlaybackLogContext extends LogContext {
	trackId?: number | string;
	trackTitle?: string;
	artistName?: string;
	quality?: string;
	requestedQuality?: string;
	actualQuality?: string;
	fallbackQuality?: string;
	fallbackReason?: string;
	phase?: PlaybackPhase;
	duration?: number;
	currentTime?: number;
	bufferedPercent?: number;
	errorCode?: number;
	errorMessage?: string;
	isRecovering?: boolean;
	isDashPlayback?: boolean;
	isFallback?: boolean;
	attemptNumber?: number;
	streamUrl?: string;
}

export interface PlaybackOperation {
	id: string;
	trackId: number | string;
	trackTitle?: string;
	artistName?: string;
	requestedQuality: string;
	startTime: number;
	events: PlaybackEvent[];
	status: 'loading' | 'playing' | 'paused' | 'error' | 'completed' | 'fallback';
	fallbackAttempts: FallbackAttempt[];
	finalQuality?: string;
	totalDuration?: number;
	finalError?: string;
}

export interface PlaybackEvent {
	timestamp: number;
	phase: PlaybackPhase;
	level: LogLevel;
	message: string;
	context: PlaybackLogContext;
}

export interface FallbackAttempt {
	timestamp: number;
	fromQuality: string;
	toQuality: string;
	reason: string;
	success: boolean;
	duration?: number;
	error?: string;
}

// In-memory store for recent operations
const recentOperations = new Map<string, PlaybackOperation>();
const MAX_OPERATIONS = 50;
const OPERATION_TTL = 15 * 60 * 1000; // 15 minutes

let currentOperation: PlaybackOperation | null = null;

const generateOperationId = (): string =>
	`pb-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

/**
 * Creates a new playback operation tracker.
 * Call this when starting to load a new track.
 */
export const startPlaybackOperation = (
	trackId: number | string,
	context: Partial<PlaybackLogContext> = {}
): PlaybackOperationLogger => {
	const id = generateOperationId();
	const startTime = Date.now();

	const operation: PlaybackOperation = {
		id,
		trackId,
		trackTitle: context.trackTitle,
		artistName: context.artistName,
		requestedQuality: context.requestedQuality || context.quality || 'unknown',
		startTime,
		events: [],
		status: 'loading',
		fallbackAttempts: []
	};

	// Store operation
	recentOperations.set(id, operation);
	currentOperation = operation;

	// Cleanup old operations
	cleanupOldOperations();

	logger.info('Starting track playback', {
		component: 'playback-observability',
		correlationId: id,
		operation: 'load_track',
		trackId: String(trackId),
		...context,
		phase: 'load_start'
	});

	recordMetric('playback_operation_start', 1, {
		trackId: String(trackId),
		quality: context.quality || 'unknown'
	});

	return createOperationLogger(operation);
};

/**
 * Gets the current playback operation logger.
 * Returns null if no operation is in progress.
 */
export const getCurrentPlaybackOperation = (): PlaybackOperationLogger | null => {
	if (!currentOperation) return null;
	return createOperationLogger(currentOperation);
};

/**
 * Gets a playback operation logger by ID.
 */
export const getPlaybackOperation = (id: string): PlaybackOperationLogger | null => {
	const operation = recentOperations.get(id);
	if (!operation) return null;
	return createOperationLogger(operation);
};

export interface PlaybackOperationLogger {
	id: string;
	trackId: number | string;

	// Logging
	debug: (message: string, context?: PlaybackLogContext) => void;
	info: (message: string, context?: PlaybackLogContext) => void;
	warn: (message: string, context?: PlaybackLogContext) => void;
	error: (message: string, error?: Error, context?: PlaybackLogContext) => void;

	// State changes
	loadComplete: (quality: string, streamUrl?: string) => void;
	playing: () => void;
	paused: () => void;
	buffering: (percent?: number) => void;
	seeked: (position: number) => void;

	// Fallback tracking
	fallbackStarted: (fromQuality: string, toQuality: string, reason: string) => void;
	fallbackComplete: (quality: string, success: boolean, error?: string) => void;

	// Error handling
	audioError: (code: number, message: string, isRecoverable: boolean) => void;

	// Recovery
	recoveryStarted: (reason: string) => void;
	recoveryComplete: (success: boolean) => void;

	// Completion
	complete: (reason?: string) => void;
	fail: (error: Error | string) => void;

	// Summary
	getSummary: () => PlaybackOperation;
}

const createOperationLogger = (operation: PlaybackOperation): PlaybackOperationLogger => {
	const baseContext: PlaybackLogContext = {
		correlationId: operation.id,
		trackId: operation.trackId,
		trackTitle: operation.trackTitle,
		artistName: operation.artistName,
		requestedQuality: operation.requestedQuality
	};

	const addEvent = (phase: PlaybackPhase, level: LogLevel, message: string, context: PlaybackLogContext = {}) => {
		operation.events.push({
			timestamp: Date.now(),
			phase,
			level,
			message,
			context: { ...baseContext, ...context }
		});
	};

	const log = (level: LogLevel, message: string, context: PlaybackLogContext = {}) => {
		const fullContext = {
			component: 'playback-observability',
			...baseContext,
			...context
		};

		switch (level) {
			case LogLevel.ERROR:
				logger.error(message, fullContext);
				break;
			case LogLevel.WARN:
				logger.warn(message, fullContext);
				break;
			case LogLevel.INFO:
				logger.info(message, fullContext);
				break;
			case LogLevel.DEBUG:
				logger.debug(message, fullContext);
				break;
			case LogLevel.TRACE:
				logger.trace(message, fullContext);
				break;
		}
	};

	return {
		id: operation.id,
		trackId: operation.trackId,

		debug: (message, context = {}) => {
			addEvent(context.phase || 'loading', LogLevel.DEBUG, message, context);
			log(LogLevel.DEBUG, message, context);
		},

		info: (message, context = {}) => {
			addEvent(context.phase || 'loading', LogLevel.INFO, message, context);
			log(LogLevel.INFO, message, context);
		},

		warn: (message, context = {}) => {
			addEvent(context.phase || 'loading', LogLevel.WARN, message, context);
			log(LogLevel.WARN, message, context);
		},

		error: (message, error, context = {}) => {
			addEvent('error', LogLevel.ERROR, message, {
				...context,
				errorMessage: error?.message
			});
			log(LogLevel.ERROR, message, {
				...context,
				error,
				errorMessage: error?.message
			});
			if (error) {
				trackError(error, {
					component: 'playback-observability',
					domain: 'playback',
					correlationId: operation.id,
					trackId: String(operation.trackId),
					...context
				});
			}
		},

		loadComplete: (quality, streamUrl) => {
			const duration = Date.now() - operation.startTime;
			operation.finalQuality = quality;
			operation.status = 'playing';

			addEvent('load_complete', LogLevel.INFO, `Track loaded in ${quality} quality`, {
				actualQuality: quality,
				streamUrl,
				duration
			});

			log(LogLevel.INFO, `Track loaded successfully`, {
				phase: 'load_complete',
				actualQuality: quality,
				duration
			});

			recordMetric('playback_load_time', duration, {
				trackId: String(operation.trackId),
				quality
			});
		},

		playing: () => {
			operation.status = 'playing';
			addEvent('playing', LogLevel.DEBUG, 'Playback started');
			log(LogLevel.DEBUG, 'Playback started', { phase: 'playing' });
		},

		paused: () => {
			operation.status = 'paused';
			addEvent('paused', LogLevel.DEBUG, 'Playback paused');
			log(LogLevel.DEBUG, 'Playback paused', { phase: 'paused' });
		},

		buffering: (percent) => {
			addEvent('buffering', LogLevel.DEBUG, `Buffering${percent ? `: ${percent}%` : ''}`, {
				bufferedPercent: percent
			});
		},

		seeked: (position) => {
			addEvent('playing', LogLevel.DEBUG, `Seeked to ${position}s`, {
				currentTime: position
			});
		},

		fallbackStarted: (fromQuality, toQuality, reason) => {
			operation.status = 'fallback';

			const attempt: FallbackAttempt = {
				timestamp: Date.now(),
				fromQuality,
				toQuality,
				reason,
				success: false
			};
			operation.fallbackAttempts.push(attempt);

			addEvent('fallback_start', LogLevel.WARN, `Fallback started: ${fromQuality} -> ${toQuality}`, {
				fallbackQuality: toQuality,
				fallbackReason: reason,
				isFallback: true,
				attemptNumber: operation.fallbackAttempts.length
			});

			log(LogLevel.WARN, `Starting fallback from ${fromQuality} to ${toQuality}: ${reason}`, {
				phase: 'fallback_start',
				fallbackQuality: toQuality,
				fallbackReason: reason,
				isFallback: true
			});

			recordMetric('playback_fallback_started', 1, {
				trackId: String(operation.trackId),
				fromQuality,
				toQuality,
				reason
			});
		},

		fallbackComplete: (quality, success, error) => {
			const lastAttempt = operation.fallbackAttempts[operation.fallbackAttempts.length - 1];
			if (lastAttempt) {
				lastAttempt.success = success;
				lastAttempt.duration = Date.now() - lastAttempt.timestamp;
				lastAttempt.error = error;
			}

			if (success) {
				operation.status = 'playing';
				operation.finalQuality = quality;
				addEvent('fallback_complete', LogLevel.INFO, `Fallback successful: now playing ${quality}`, {
					actualQuality: quality,
					isFallback: true
				});
				log(LogLevel.INFO, `Fallback completed successfully, playing ${quality}`, {
					phase: 'fallback_complete',
					actualQuality: quality
				});
			} else {
				operation.status = 'error';
				addEvent('fallback_failed', LogLevel.ERROR, `Fallback failed: ${error || 'unknown error'}`, {
					errorMessage: error,
					isFallback: true
				});
				log(LogLevel.ERROR, `Fallback failed: ${error}`, {
					phase: 'fallback_failed',
					errorMessage: error
				});
			}

			recordMetric('playback_fallback_completed', success ? 1 : 0, {
				trackId: String(operation.trackId),
				quality,
				success: String(success)
			});
		},

		audioError: (code, message, isRecoverable) => {
			operation.status = 'error';
			addEvent('error', LogLevel.ERROR, `Audio error (code ${code}): ${message}`, {
				errorCode: code,
				errorMessage: message,
				isRecovering: isRecoverable
			});
			log(LogLevel.ERROR, `Audio error: ${message}`, {
				phase: 'error',
				errorCode: code,
				errorMessage: message
			});

			recordMetric('playback_audio_error', 1, {
				trackId: String(operation.trackId),
				errorCode: String(code),
				recoverable: String(isRecoverable)
			});
		},

		recoveryStarted: (reason) => {
			addEvent('recovery', LogLevel.INFO, `Recovery started: ${reason}`, {
				isRecovering: true
			});
			log(LogLevel.INFO, `Starting recovery: ${reason}`, {
				phase: 'recovery',
				isRecovering: true
			});
		},

		recoveryComplete: (success) => {
			if (success) {
				operation.status = 'playing';
				addEvent('recovery', LogLevel.INFO, 'Recovery successful', {
					isRecovering: false
				});
				log(LogLevel.INFO, 'Recovery completed successfully', { phase: 'recovery' });
			} else {
				addEvent('error', LogLevel.ERROR, 'Recovery failed', {
					isRecovering: false
				});
				log(LogLevel.ERROR, 'Recovery failed', { phase: 'error' });
			}

			recordMetric('playback_recovery_completed', success ? 1 : 0, {
				trackId: String(operation.trackId)
			});
		},

		complete: (reason) => {
			const duration = Date.now() - operation.startTime;
			operation.status = 'completed';
			operation.totalDuration = duration;

			addEvent('load_complete', LogLevel.INFO, reason || 'Playback completed', { duration });
			log(LogLevel.INFO, reason || 'Playback completed', {
				phase: 'load_complete',
				duration
			});

			recordMetric('playback_operation_complete', duration, {
				trackId: String(operation.trackId),
				quality: operation.finalQuality || 'unknown'
			});

			// Clear current operation
			if (currentOperation?.id === operation.id) {
				currentOperation = null;
			}
		},

		fail: (error) => {
			const duration = Date.now() - operation.startTime;
			operation.status = 'error';
			operation.totalDuration = duration;
			operation.finalError = error instanceof Error ? error.message : error;

			addEvent('error', LogLevel.ERROR, `Playback failed: ${operation.finalError}`, { duration });
			log(LogLevel.ERROR, `Playback failed: ${operation.finalError}`, {
				phase: 'error',
				duration,
				error: error instanceof Error ? error : undefined
			});

			if (error instanceof Error) {
				trackError(error, {
					component: 'playback-observability',
					domain: 'playback',
					correlationId: operation.id,
					trackId: String(operation.trackId)
				});
			}

			recordMetric('playback_operation_failed', 1, {
				trackId: String(operation.trackId)
			});

			// Clear current operation
			if (currentOperation?.id === operation.id) {
				currentOperation = null;
			}
		},

		getSummary: () => ({ ...operation })
	};
};

/**
 * Get recent playback operations for debugging.
 */
export const getRecentPlaybackOperations = (
	options: { limit?: number; status?: PlaybackOperation['status'] } = {}
): PlaybackOperation[] => {
	const { limit = 20, status } = options;
	let operations = Array.from(recentOperations.values());

	if (status) {
		operations = operations.filter((op) => op.status === status);
	}

	// Sort by start time descending
	operations.sort((a, b) => b.startTime - a.startTime);

	return operations.slice(0, limit);
};

/**
 * Get playback statistics.
 */
export const getPlaybackStats = () => {
	const operations = Array.from(recentOperations.values());
	const now = Date.now();
	const oneHourAgo = now - 60 * 60 * 1000;

	const recentOps = operations.filter((op) => op.startTime > oneHourAgo);
	const completed = recentOps.filter((op) => op.status === 'completed' || op.status === 'playing');
	const failed = recentOps.filter((op) => op.status === 'error');
	const withFallback = recentOps.filter((op) => op.fallbackAttempts.length > 0);
	const successfulFallbacks = withFallback.filter((op) =>
		op.fallbackAttempts.some((f) => f.success)
	);

	return {
		total: recentOps.length,
		completed: completed.length,
		failed: failed.length,
		successRate: recentOps.length > 0 ? (completed.length / recentOps.length) * 100 : 0,
		fallbackAttempts: withFallback.length,
		fallbackSuccessRate:
			withFallback.length > 0 ? (successfulFallbacks.length / withFallback.length) * 100 : 0,
		fallbackReasons: withFallback.reduce(
			(acc, op) => {
				for (const attempt of op.fallbackAttempts) {
					acc[attempt.reason] = (acc[attempt.reason] || 0) + 1;
				}
				return acc;
			},
			{} as Record<string, number>
		)
	};
};

/**
 * Cleanup old operations to prevent memory leaks.
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
 * Clear all operations (for testing).
 */
export const clearPlaybackOperations = () => {
	recentOperations.clear();
	currentOperation = null;
};

/**
 * Simple logging functions for standalone use.
 */
export const playbackLogger = {
	debug: (message: string, context: PlaybackLogContext = {}) =>
		logger.debug(message, { component: 'playback', ...context }),
	info: (message: string, context: PlaybackLogContext = {}) =>
		logger.info(message, { component: 'playback', ...context }),
	warn: (message: string, context: PlaybackLogContext = {}) =>
		logger.warn(message, { component: 'playback', ...context }),
	error: (message: string, error?: Error, context: PlaybackLogContext = {}) => {
		logger.error(message, { component: 'playback', error, ...context });
		if (error) {
			trackError(error, { component: 'playback', domain: 'playback', ...context });
		}
	}
};
