// Structured logging system for consistent, observable logging
// Provides correlation IDs, log levels, and structured data formatting

export enum LogLevel {
	ERROR = 0,
	WARN = 1,
	INFO = 2,
	DEBUG = 3,
	TRACE = 4
}

export interface LogContext {
	correlationId?: string;
	userId?: string;
	sessionId?: string;
	requestId?: string;
	component?: string;
	operation?: string;
	duration?: number;
	error?: Error;
	metadata?: Record<string, unknown>;
	// Allow additional properties for flexibility
	[key: string]: unknown;
}

export interface LogEntry {
	timestamp: string;
	level: LogLevel;
	message: string;
	context: LogContext;
	stack?: string;
}

export class Logger {
	private static instance: Logger;
	private currentLevel: LogLevel = LogLevel.INFO;
	private correlationId: string | null = null;
	private listeners: Array<(entry: LogEntry) => void> = [];

	private constructor() {}

	public static getInstance(): Logger {
		if (!Logger.instance) {
			Logger.instance = new Logger();
		}
		return Logger.instance;
	}

	public setLevel(level: LogLevel): void {
		this.currentLevel = level;
	}

	public setCorrelationId(id: string | null): void {
		this.correlationId = id;
	}

	public generateCorrelationId(): string {
		return `log-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	public addListener(listener: (entry: LogEntry) => void): () => void {
		this.listeners.push(listener);
		return () => {
			const index = this.listeners.indexOf(listener);
			if (index > -1) {
				this.listeners.splice(index, 1);
			}
		};
	}

	private shouldLog(level: LogLevel): boolean {
		return level <= this.currentLevel;
	}

	private createLogEntry(level: LogLevel, message: string, context: LogContext = {}): LogEntry {
		const entry: LogEntry = {
			timestamp: new Date().toISOString(),
			level,
			message,
			context: {
				correlationId: context.correlationId || this.correlationId || undefined,
				...context
			}
		};

		if (level === LogLevel.ERROR && context.error) {
			entry.stack = context.error.stack;
		}

		return entry;
	}

	private emit(entry: LogEntry): void {
		this.listeners.forEach((listener) => {
			try {
				listener(entry);
			} catch (error) {
				// Prevent logging errors from breaking the application
				console.error('Logger listener error:', error);
			}
		});
	}

	private log(level: LogLevel, message: string, context: LogContext = {}): void {
		if (!this.shouldLog(level)) {
			return;
		}

		const entry = this.createLogEntry(level, message, context);
		this.emit(entry);

		// Also log to console for development
		this.consoleLog(entry);
	}

	private consoleLog(entry: LogEntry): void {
		const correlation = entry.context.correlationId ? `[${entry.context.correlationId}]` : '';
		const component = entry.context.component ? `[${entry.context.component}]` : '';
		const prefix = `${correlation}${component}`.trim();

		const message = prefix ? `${prefix} ${entry.message}` : entry.message;

		switch (entry.level) {
			case LogLevel.ERROR:
				console.error(message, entry.context, entry.stack);
				break;
			case LogLevel.WARN:
				console.warn(message, entry.context);
				break;
			case LogLevel.INFO:
				console.info(message, entry.context);
				break;
			case LogLevel.DEBUG:
				console.debug(message, entry.context);
				break;
			case LogLevel.TRACE:
				console.trace(message, entry.context);
				break;
		}
	}

	// Public logging methods
	public error(message: string, context: LogContext = {}): void {
		this.log(LogLevel.ERROR, message, context);
	}

	public warn(message: string, context: LogContext = {}): void {
		this.log(LogLevel.WARN, message, context);
	}

	public info(message: string, context: LogContext = {}): void {
		this.log(LogLevel.INFO, message, context);
	}

	public debug(message: string, context: LogContext = {}): void {
		this.log(LogLevel.DEBUG, message, context);
	}

	public trace(message: string, context: LogContext = {}): void {
		this.log(LogLevel.TRACE, message, context);
	}

	// Convenience methods for operations
	public startOperation(operation: string, context: LogContext = {}): OperationLogger {
		const correlationId = this.generateCorrelationId();
		const startTime = performance.now();

		this.info(`Starting operation: ${operation}`, {
			...context,
			correlationId,
			operation,
			phase: 'start'
		});

		return new OperationLogger(this, operation, correlationId, startTime, context);
	}

	public logAPIRequest(method: string, url: string, context: LogContext = {}): void {
		this.info(`API ${method} ${url}`, {
			...context,
			component: 'api',
			method,
			url
		});
	}

	public logAPIResponse(
		method: string,
		url: string,
		status: number,
		duration: number,
		context: LogContext = {}
	): void {
		const level = status >= 400 ? LogLevel.WARN : LogLevel.DEBUG;
		const message = `API ${method} ${url} - ${status} (${duration.toFixed(2)}ms)`;

		this.log(level, message, {
			...context,
			component: 'api',
			method,
			url,
			status,
			duration
		});
	}

	public logStateTransition(
		from: string,
		to: string,
		event: string,
		context: LogContext = {}
	): void {
		this.debug(`State transition: ${from} -> ${to} [${event}]`, {
			...context,
			component: 'state-machine',
			fromState: from,
			toState: to,
			event
		});
	}

	public logPerformance(
		operation: string,
		duration: number,
		threshold?: number,
		context: LogContext = {}
	): void {
		const exceeded = threshold && duration > threshold;
		const level = exceeded ? LogLevel.WARN : LogLevel.DEBUG;
		const message = `Performance: ${operation} took ${duration.toFixed(2)}ms${threshold ? ` (threshold: ${threshold}ms)` : ''}`;

		this.log(level, message, {
			...context,
			component: 'performance',
			operation,
			duration,
			threshold,
			exceededThreshold: exceeded
		});
	}
}

export class OperationLogger {
	private logger: Logger;
	private operation: string;
	private correlationId: string;
	private startTime: number;
	private context: LogContext;

	constructor(
		logger: Logger,
		operation: string,
		correlationId: string,
		startTime: number,
		context: LogContext
	) {
		this.logger = logger;
		this.operation = operation;
		this.correlationId = correlationId;
		this.startTime = startTime;
		this.context = context;
	}

	public info(message: string, additionalContext: LogContext = {}): void {
		this.logger.info(message, {
			...this.context,
			...additionalContext,
			correlationId: this.correlationId,
			operation: this.operation
		});
	}

	public warn(message: string, additionalContext: LogContext = {}): void {
		this.logger.warn(message, {
			...this.context,
			...additionalContext,
			correlationId: this.correlationId,
			operation: this.operation
		});
	}

	public error(message: string, error?: Error, additionalContext: LogContext = {}): void {
		this.logger.error(message, {
			...this.context,
			...additionalContext,
			correlationId: this.correlationId,
			operation: this.operation,
			error
		});
	}

	public complete(result?: unknown, additionalContext: LogContext = {}): void {
		const duration = performance.now() - this.startTime;

		this.logger.info(`Completed operation: ${this.operation}`, {
			...this.context,
			...additionalContext,
			correlationId: this.correlationId,
			operation: this.operation,
			phase: 'complete',
			duration,
			result: result ? 'success' : 'failure'
		});

		this.logger.logPerformance(this.operation, duration, undefined, {
			...this.context,
			correlationId: this.correlationId,
			operation: this.operation
		});
	}

	public fail(error: Error, additionalContext: LogContext = {}): void {
		const duration = performance.now() - this.startTime;

		this.logger.error(`Failed operation: ${this.operation}`, {
			...this.context,
			...additionalContext,
			correlationId: this.correlationId,
			operation: this.operation,
			phase: 'failed',
			duration,
			error
		});
	}
}

// Global logger instance
export const logger = Logger.getInstance();

// Initialize with appropriate log level for environment
if (import.meta.env.DEV) {
	logger.setLevel(LogLevel.DEBUG);
} else {
	logger.setLevel(LogLevel.INFO);
}
