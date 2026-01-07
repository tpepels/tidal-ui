// Error tracking and reporting system
// Collects errors from various sources and provides reporting capabilities

import { logger } from './logger';

export interface ErrorReport {
	id: string;
	timestamp: number;
	error: Error;
	context: ErrorContext;
	stack?: string;
	userAgent?: string;
	url?: string;
	userId?: string;
	sessionId?: string;
	severity: 'low' | 'medium' | 'high' | 'critical';
	frequency: number; // How many times this error has occurred
	firstSeen: number;
	lastSeen: number;
}

export interface ErrorSummary {
	totalErrors: number;
	uniqueErrors: number;
	criticalErrors: number;
	recentErrors: ErrorReport[];
	topErrors: Array<{
		error: string;
		count: number;
		lastSeen: number;
		severity: string;
	}>;
	errorRate: number; // Errors per minute
}

export type ErrorSummarySnapshot = {
	capturedAt: number;
	summary: ErrorSummary;
	domainCounts: Record<string, number>;
};

export type ErrorContext = Record<string, unknown> & {
	source?: string;
	filename?: string;
	lineno?: number;
	colno?: number;
	status?: number;
	userAgent?: string;
	url?: string;
	userId?: string;
	sessionId?: string;
	domain?: string;
};

export class ErrorTracker {
	private static instance: ErrorTracker;
	private errors: ErrorReport[] = [];
	private errorGroups: Map<string, ErrorReport[]> = new Map();
	private maxErrors = 1000; // Keep last 1000 errors
	private listeners: Array<(error: ErrorReport) => void> = [];

	private constructor() {
		this.setupGlobalErrorHandling();
	}

	public static getInstance(): ErrorTracker {
		if (!ErrorTracker.instance) {
			ErrorTracker.instance = new ErrorTracker();
		}
		return ErrorTracker.instance;
	}

	private setupGlobalErrorHandling(): void {
		// Global error handling for uncaught errors
		if (typeof window !== 'undefined') {
			window.addEventListener('error', (event) => {
				this.trackError(event.error || new Error(event.message), {
					source: 'global',
					filename: event.filename,
					lineno: event.lineno,
					colno: event.colno,
					userAgent: navigator.userAgent,
					url: window.location.href
				});
			});

			window.addEventListener('unhandledrejection', (event) => {
				this.trackError(
					event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
					{
						source: 'unhandled-promise-rejection',
						userAgent: navigator.userAgent,
						url: window.location.href
					}
				);
			});
		}
	}

	public trackError(error: Error, context: ErrorContext = {}): string {
		const errorId = this.generateErrorId();
		const now = Date.now();

		// Determine severity based on error type and context
		const severity = this.determineSeverity(error, context);

		const errorReport: ErrorReport = {
			id: errorId,
			timestamp: now,
			error,
			context,
			stack: error.stack,
			userAgent: context.userAgent,
			url: context.url,
			userId: context.userId,
			sessionId: context.sessionId,
			severity,
			frequency: 1,
			firstSeen: now,
			lastSeen: now
		};

		// Group similar errors
		const groupKey = this.getErrorGroupKey(error, context);
		const existingGroup = this.errorGroups.get(groupKey) || [];

		if (existingGroup.length > 0) {
			// Update frequency and last seen for existing group
			const latestError = existingGroup[existingGroup.length - 1];
			errorReport.frequency = latestError.frequency + 1;
			errorReport.firstSeen = latestError.firstSeen;
		}

		existingGroup.push(errorReport);
		this.errorGroups.set(groupKey, existingGroup);

		// Add to main errors list
		this.errors.push(errorReport);

		// Maintain size limits
		if (this.errors.length > this.maxErrors) {
			this.errors = this.errors.slice(-this.maxErrors);
		}

		// Clean up old error groups (keep only recent ones)
		this.cleanupOldGroups();

		// Log the error
		logger.error('Error tracked', {
			component: 'error-tracker',
			errorId,
			error,
			severity,
			frequency: errorReport.frequency,
			source: context.source || 'unknown',
			...context
		});

		// Notify listeners
		this.listeners.forEach((listener) => {
			try {
				listener(errorReport);
			} catch (listenerError) {
				logger.error('Error tracker listener failed', {
					component: 'error-tracker',
					listenerError:
						listenerError instanceof Error ? listenerError : new Error(String(listenerError))
				});
			}
		});

		this.persistErrorSummary();

		return errorId;
	}

	private generateErrorId(): string {
		return `err-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	private determineSeverity(error: Error, context: ErrorContext): ErrorReport['severity'] {
		// Critical errors
		if (error.name === 'InvariantViolationError') {
			return 'critical';
		}

		if (context.source === 'global' || context.source === 'unhandled-promise-rejection') {
			return 'high';
		}

		// Network-related errors
		if (
			error.message.includes('fetch') ||
			error.message.includes('network') ||
			error.message.includes('CORS')
		) {
			return 'medium';
		}

		// API errors
		if (context.component === 'api' && typeof context.status === 'number' && context.status >= 500) {
			return 'high';
		}

		// State machine errors
		if (context.component === 'state-machine') {
			return 'medium';
		}

		// Default to low severity
		return 'low';
	}

	private getErrorGroupKey(error: Error, context: ErrorContext): string {
		// Group errors by message and stack location
		const message = error.message;
		const stack = error.stack?.split('\n')[1] || ''; // First stack frame
		const component = context.component || 'unknown';
		const source = context.source || 'unknown';

		return `${component}:${source}:${message}:${stack}`;
	}

	private cleanupOldGroups(): void {
		const oneHourAgo = Date.now() - 60 * 60 * 1000;

		for (const [key, group] of this.errorGroups.entries()) {
			// Remove groups where last error is older than 1 hour
			const lastError = group[group.length - 1];
			if (lastError.timestamp < oneHourAgo) {
				this.errorGroups.delete(key);
			}
		}
	}

	public getErrorSummary(timeRangeMs: number = 3600000): ErrorSummary {
		// Default 1 hour
		const startTime = Date.now() - timeRangeMs;
		const recentErrors = this.errors.filter((e) => e.timestamp >= startTime);

		const uniqueErrors = new Map<string, ErrorReport[]>();
		for (const error of recentErrors) {
			const key = this.getErrorGroupKey(error.error, error.context);
			const existing = uniqueErrors.get(key) || [];
			existing.push(error);
			uniqueErrors.set(key, existing);
		}

		// Get top errors by frequency
		const topErrors = Array.from(uniqueErrors.entries())
			.map(([, errors]) => {
				const latestError = errors[errors.length - 1];
				return {
					error: latestError.error.message,
					count: errors.length,
					lastSeen: latestError.timestamp,
					severity: latestError.severity
				};
			})
			.sort((a, b) => b.count - a.count)
			.slice(0, 10);

		const criticalErrors = recentErrors.filter((e) => e.severity === 'critical').length;
		const errorRate = recentErrors.length / (timeRangeMs / (60 * 1000)); // Errors per minute

		return {
			totalErrors: recentErrors.length,
			uniqueErrors: uniqueErrors.size,
			criticalErrors,
			recentErrors: recentErrors.slice(-50), // Last 50 errors
			topErrors,
			errorRate: Math.round(errorRate * 100) / 100
		};
	}

	public getDomainSummary(timeRangeMs: number = 3600000): Record<string, number> {
		const startTime = Date.now() - timeRangeMs;
		const recentErrors = this.errors.filter((e) => e.timestamp >= startTime);
		const counts: Record<string, number> = {};
		for (const error of recentErrors) {
			const domain = this.getDomainFromContext(error.context);
			counts[domain] = (counts[domain] ?? 0) + 1;
		}
		return counts;
	}

	public getErrors(timeRangeMs: number = 3600000): ErrorReport[] {
		const startTime = Date.now() - timeRangeMs;
		return this.errors.filter((e) => e.timestamp >= startTime);
	}

	public getErrorById(id: string): ErrorReport | null {
		return this.errors.find((e) => e.id === id) || null;
	}

	public clearErrors(): void {
		this.errors = [];
		this.errorGroups.clear();
	}

	public getPersistedSummary(): ErrorSummarySnapshot | null {
		if (typeof window === 'undefined') {
			return null;
		}
		try {
			const raw = window.localStorage.getItem('tidal-ui.error-summary');
			if (!raw) {
				return null;
			}
			return JSON.parse(raw) as ErrorSummarySnapshot;
		} catch {
			return null;
		}
	}

	private getDomainFromContext(context: ErrorContext): string {
		if (context.domain && typeof context.domain === 'string') {
			return context.domain;
		}
		const component = typeof context.component === 'string' ? context.component : '';
		if (component.includes('download')) {
			return 'download';
		}
		if (component.includes('search')) {
			return 'search';
		}
		if (
			component.includes('playback') ||
			component.includes('audio') ||
			component.includes('state-machine')
		) {
			return 'playback';
		}
		return 'other';
	}

	private persistErrorSummary(): void {
		if (typeof window === 'undefined') {
			return;
		}
		try {
			const snapshot: ErrorSummarySnapshot = {
				capturedAt: Date.now(),
				summary: this.getErrorSummary(),
				domainCounts: this.getDomainSummary()
			};
			window.localStorage.setItem('tidal-ui.error-summary', JSON.stringify(snapshot));
		} catch {
			// Ignore localStorage failures.
		}
	}

	public addErrorListener(listener: (error: ErrorReport) => void): () => void {
		this.listeners.push(listener);
		return () => {
			const index = this.listeners.indexOf(listener);
			if (index > -1) {
				this.listeners.splice(index, 1);
			}
		};
	}

	public exportErrors(): string {
		return JSON.stringify(
			{
				exportedAt: Date.now(),
				totalErrors: this.errors.length,
				errors: this.errors.slice(-100) // Last 100 errors
			},
			null,
			2
		);
	}
}

// Global error tracker instance
export const errorTracker = ErrorTracker.getInstance();

// Convenience functions
export function trackError(error: Error, context: ErrorContext = {}): string {
	return errorTracker.trackError(error, context);
}

export function getErrorSummary(timeRangeMs?: number): ErrorSummary {
	return errorTracker.getErrorSummary(timeRangeMs);
}

export function getPersistedErrorSummary(): ErrorSummarySnapshot | null {
	return errorTracker.getPersistedSummary();
}
