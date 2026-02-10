/**
 * Observability module for download tracking and metrics
 * Provides structured logging and metrics for monitoring download operations
 * Can be extended to integrate with monitoring systems (Prometheus, DataDog, etc.)
 */

export interface DownloadStartEvent {
	type: 'download_start';
	trackId: number;
	quality: string;
	target: string;
	timestamp: number;
	attemptNumber?: number;
}

export interface DownloadSuccessEvent {
	type: 'download_success';
	trackId: number;
	quality: string;
	target: string;
	durationMs: number;
	bytesDownloaded: number;
	timestamp: number;
	attemptNumber?: number;
}

export interface DownloadFailureEvent {
	type: 'download_failure';
	trackId: number;
	quality: string;
	target?: string;
	error: string;
	errorType?: string;
	durationMs?: number;
	timestamp: number;
	attemptNumber?: number;
	isRetriable: boolean;
}

export interface TargetHealthChangeEvent {
	type: 'target_health_change';
	target: string;
	status: 'healthy' | 'unhealthy' | 'recovering';
	reason?: string;
	timestamp: number;
	consecutiveFailures?: number;
}

export interface CircuitBreakerEvent {
	type: 'circuit_breaker_event';
	target: string;
	action: 'open' | 'close' | 'reset';
	reason?: string;
	timestamp: number;
	consecutiveFailures?: number;
}

export type ObservabilityEvent =
	| DownloadStartEvent
	| DownloadSuccessEvent
	| DownloadFailureEvent
	| TargetHealthChangeEvent
	| CircuitBreakerEvent;

/**
 * Observability handler - can be extended to send metrics to external systems
 */
type ObservabilityHandler = (event: ObservabilityEvent) => void;

const handlers: ObservabilityHandler[] = [];

/**
 * Register an observability handler to receive metrics events
 */
export function registerObservabilityHandler(handler: ObservabilityHandler): () => void {
	handlers.push(handler);
	return () => {
		const index = handlers.indexOf(handler);
		if (index > -1) {
			handlers.splice(index, 1);
		}
	};
}

/**
 * Emit an observability event to all registered handlers
 */
function emitEvent(event: ObservabilityEvent): void {
	// Log to console in development for visibility
	if (typeof window !== 'undefined') {
		console.debug(`[Metrics] ${event.type}:`, event);
	}

	// Emit to all registered handlers
	for (const handler of handlers) {
		try {
			handler(event);
		} catch (error) {
			console.error(`[Metrics] Handler error:`, error);
		}
	}
}

/**
 * Track download start
 */
export function recordDownloadStart(
	trackId: number,
	quality: string,
	target: string,
	attemptNumber?: number
): void {
	emitEvent({
		type: 'download_start',
		trackId,
		quality,
		target,
		timestamp: Date.now(),
		attemptNumber
	});
}

/**
 * Track successful download
 */
export function recordDownloadSuccess(
	trackId: number,
	quality: string,
	target: string,
	durationMs: number,
	bytesDownloaded: number,
	attemptNumber?: number
): void {
	emitEvent({
		type: 'download_success',
		trackId,
		quality,
		target,
		durationMs,
		bytesDownloaded,
		timestamp: Date.now(),
		attemptNumber
	});
}

/**
 * Track download failure
 */
export function recordDownloadFailure(
	trackId: number,
	quality: string,
	error: string,
	options?: {
		target?: string;
		durationMs?: number;
		attemptNumber?: number;
		isRetriable?: boolean;
		errorType?: string;
	}
): void {
	emitEvent({
		type: 'download_failure',
		trackId,
		quality,
		target: options?.target,
		error,
		errorType: options?.errorType,
		durationMs: options?.durationMs,
		timestamp: Date.now(),
		attemptNumber: options?.attemptNumber,
		isRetriable: options?.isRetriable ?? true
	});
}

/**
 * Track target health changes
 */
export function recordTargetHealthChange(
	target: string,
	status: 'healthy' | 'unhealthy' | 'recovering',
	options?: {
		reason?: string;
		consecutiveFailures?: number;
	}
): void {
	emitEvent({
		type: 'target_health_change',
		target,
		status,
		reason: options?.reason,
		timestamp: Date.now(),
		consecutiveFailures: options?.consecutiveFailures
	});
}

/**
 * Track circuit breaker events
 */
export function recordCircuitBreakerEvent(
	target: string,
	action: 'open' | 'close' | 'reset',
	options?: {
		reason?: string;
		consecutiveFailures?: number;
	}
): void {
	emitEvent({
		type: 'circuit_breaker_event',
		target,
		action,
		reason: options?.reason,
		timestamp: Date.now(),
		consecutiveFailures: options?.consecutiveFailures
	});
}

/**
 * Default handler: logs structured metrics to console
 * Useful for development and debugging
 */
export function createConsoleMetricsHandler(): ObservabilityHandler {
	return (event: ObservabilityEvent) => {
		const timestamp = new Date(event.timestamp).toISOString();
		
		switch (event.type) {
			case 'download_start': {
				console.log(
					`[${timestamp}] [📥 Download Start] Track ${event.trackId} (${event.quality}) from ${event.target}` +
					(event.attemptNumber ? ` [Attempt ${event.attemptNumber}]` : '')
				);
				break;
			}

			case 'download_success': {
				const mbDownloaded = (event.bytesDownloaded / 1024 / 1024).toFixed(2);
				console.log(
					`[${timestamp}] [✅ Download Success] Track ${event.trackId}: ${mbDownloaded} MB in ${event.durationMs}ms (${event.target})` +
					(event.attemptNumber ? ` [Attempt ${event.attemptNumber}]` : '')
				);
				break;
			}

			case 'download_failure': {
				console.warn(
					`[${timestamp}] [❌ Download Failure] Track ${event.trackId}: ${event.error}` +
					(event.target ? ` (${event.target})` : '') +
					(event.attemptNumber ? ` [Attempt ${event.attemptNumber}]` : '') +
					(event.isRetriable ? ' [Will retry]' : ' [Permanent failure]')
				);
				break;
			}

			case 'target_health_change': {
				const statusEmoji = event.status === 'healthy' ? '✅' : '❌';
				console.log(
					`[${timestamp}] [${statusEmoji} Target Health] ${event.target}: ${event.status}` +
					(event.consecutiveFailures ? ` (${event.consecutiveFailures} failures)` : '') +
					(event.reason ? ` - ${event.reason}` : '')
				);
				break;
			}

			case 'circuit_breaker_event': {
				const action =
					event.action === 'open'
						? '🔴 Circuit Open'
						: event.action === 'close'
							? '🟢 Circuit Closed'
							: '🟡 Circuit Reset';
				console.log(
					`[${timestamp}] [${action}] Target ${event.target}` +
					(event.consecutiveFailures ? ` (${event.consecutiveFailures} failures)` : '') +
					(event.reason ? ` - ${event.reason}` : '')
				);
				break;
			}
		}
	};
}
