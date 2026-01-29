// Performance monitoring and metrics collection
// Provides real-time performance tracking and alerting

import { logger } from './logger';

export interface PerformanceMetric {
	name: string;
	value: number;
	timestamp: number;
	tags: Record<string, string>;
}

export interface PerformanceThreshold {
	metric: string;
	warningThreshold: number;
	errorThreshold: number;
	description: string;
}

export interface PerformanceReport {
	period: {
		start: number;
		end: number;
		duration: number;
	};
	metrics: PerformanceMetric[];
	thresholds: {
		exceeded: PerformanceThreshold[];
		warnings: PerformanceThreshold[];
	};
	summary: {
		totalMetrics: number;
		averageResponseTime: number;
		maxResponseTime: number;
		minResponseTime: number;
		p95ResponseTime: number;
		errorRate: number;
	};
}

export class PerformanceMonitor {
	private static instance: PerformanceMonitor;
	private metrics: PerformanceMetric[] = [];
	private thresholds: PerformanceThreshold[] = [];
	private listeners: Array<(report: PerformanceReport) => void> = [];
	private collectionInterval: number | null = null;
	private isCollecting = false;

	private constructor() {
		this.initializeDefaultThresholds();
	}

	public static getInstance(): PerformanceMonitor {
		if (!PerformanceMonitor.instance) {
			PerformanceMonitor.instance = new PerformanceMonitor();
		}
		return PerformanceMonitor.instance;
	}

	private initializeDefaultThresholds(): void {
		this.thresholds = [
			{
				metric: 'api_response_time',
				warningThreshold: 1000, // 1 second
				errorThreshold: 5000, // 5 seconds
				description: 'API response time threshold'
			},
			{
				metric: 'state_machine_transition',
				warningThreshold: 50, // 50ms
				errorThreshold: 200, // 200ms
				description: 'State machine transition time threshold'
			},
			{
				metric: 'component_render',
				warningThreshold: 100, // 100ms
				errorThreshold: 500, // 500ms
				description: 'Component render time threshold'
			},
			{
				metric: 'memory_usage_mb',
				warningThreshold: 100, // 100MB
				errorThreshold: 200, // 200MB
				description: 'Memory usage threshold'
			}
		];
	}

	public recordMetric(name: string, value: number, tags: Record<string, string> = {}): void {
		const providedCorrelationId = tags.correlationId ?? undefined;
		const resolvedCorrelationId = providedCorrelationId ?? logger.getCorrelationId() ?? 'missing';
		const missingCorrelationId = resolvedCorrelationId === 'missing';
		const metricTags =
			providedCorrelationId || resolvedCorrelationId === 'missing'
				? { ...tags, correlationId: resolvedCorrelationId }
				: tags;

		const metric: PerformanceMetric = {
			name,
			value,
			timestamp: Date.now(),
			tags: metricTags
		};

		this.metrics.push(metric);

		// Check thresholds
		this.checkThresholds(metric);

		// Keep only recent metrics (last 24 hours)
		const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
		this.metrics = this.metrics.filter((m) => m.timestamp > oneDayAgo);

		// Log significant metrics
		if (value > 1000) {
			// Log anything over 1 second
			logger.warn(`Performance metric recorded: ${name}`, {
				component: 'performance',
				metric: name,
				value,
				tags: metricTags,
				correlationId: resolvedCorrelationId,
				missingCorrelationId,
				thresholdExceeded: this.isThresholdExceeded(metric)
			});
		}
	}

	private checkThresholds(metric: PerformanceMetric): void {
		const threshold = this.thresholds.find((t) => t.metric === metric.name);
		if (!threshold) return;

		if (metric.value >= threshold.errorThreshold) {
			logger.error(`Performance threshold exceeded: ${threshold.description}`, {
				component: 'performance',
				metric: metric.name,
				value: metric.value,
				threshold: threshold.errorThreshold,
				level: 'error',
				tags: metric.tags
			});
		} else if (metric.value >= threshold.warningThreshold) {
			logger.warn(`Performance threshold warning: ${threshold.description}`, {
				component: 'performance',
				metric: metric.name,
				value: metric.value,
				threshold: threshold.warningThreshold,
				level: 'warning',
				tags: metric.tags
			});
		}
	}

	private isThresholdExceeded(metric: PerformanceMetric): boolean {
		const threshold = this.thresholds.find((t) => t.metric === metric.name);
		return threshold ? metric.value >= threshold.warningThreshold : false;
	}

	public addThreshold(threshold: PerformanceThreshold): void {
		// Remove existing threshold with same metric name
		this.thresholds = this.thresholds.filter((t) => t.metric !== threshold.metric);
		this.thresholds.push(threshold);
	}

	public removeThreshold(metric: string): void {
		this.thresholds = this.thresholds.filter((t) => t.metric !== metric);
	}

	public getThresholds(): PerformanceThreshold[] {
		return [...this.thresholds];
	}

	public startCollection(intervalMs: number = 60000): void {
		// Default 1 minute
		if (this.isCollecting) {
			this.stopCollection();
		}

		this.isCollecting = true;
		this.collectionInterval = window.setInterval(() => {
			this.collectSystemMetrics();
		}, intervalMs);
	}

	public stopCollection(): void {
		if (this.collectionInterval) {
			clearInterval(this.collectionInterval);
			this.collectionInterval = null;
		}
		this.isCollecting = false;
	}

	private collectSystemMetrics(): void {
		type PerformanceWithMemory = Performance & {
			memory?: {
				usedJSHeapSize: number;
			};
			timing?: PerformanceTiming;
		};

		// Memory usage (if available)
		if (typeof performance !== 'undefined') {
			const perf = performance as PerformanceWithMemory;
			if (perf.memory) {
				const memoryMB = perf.memory.usedJSHeapSize / (1024 * 1024);
				this.recordMetric('memory_usage_mb', memoryMB, { source: 'performance_api' });
			}

			// Navigation timing (if available)
			if (perf.timing) {
				const loadTime = perf.timing.loadEventEnd - perf.timing.navigationStart;
				if (loadTime > 0) {
					this.recordMetric('page_load_time', loadTime, { type: 'navigation' });
				}
			}
		}

		// Resource timing for recent resources
		if (performance.getEntriesByType) {
			const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
			const recentResources = resources.filter(
				(entry) => Date.now() - entry.responseEnd < 60000 // Last minute
			);

			if (recentResources.length > 0) {
				const avgResponseTime =
					recentResources.reduce(
						(sum, entry) => sum + (entry.responseEnd - entry.requestStart),
						0
					) / recentResources.length;

				this.recordMetric('avg_resource_response_time', avgResponseTime, {
					resourceCount: recentResources.length.toString()
				});
			}
		}
	}

	public measureOperation<T>(
		name: string,
		operation: () => T | Promise<T>,
		tags: Record<string, string> = {}
	): T | Promise<T> {
		const startTime = performance.now();

		try {
			const result = operation();

			if (result instanceof Promise) {
				return result
					.then((resolved) => {
						const duration = performance.now() - startTime;
						this.recordMetric(name, duration, tags);
						return resolved;
					})
					.catch((error) => {
						const duration = performance.now() - startTime;
						this.recordMetric(`${name}_error`, duration, { ...tags, error: 'true' });
						throw error;
					});
			} else {
				const duration = performance.now() - startTime;
				this.recordMetric(name, duration, tags);
				return result;
			}
		} catch (error) {
			const duration = performance.now() - startTime;
			this.recordMetric(`${name}_error`, duration, { ...tags, error: 'true' });
			throw error;
		}
	}

	public async measureAsyncOperation<T>(
		name: string,
		operation: () => Promise<T>,
		tags: Record<string, string> = {}
	): Promise<T> {
		const startTime = performance.now();

		try {
			const result = await operation();
			const duration = performance.now() - startTime;
			this.recordMetric(name, duration, tags);
			return result;
		} catch (error) {
			const duration = performance.now() - startTime;
			this.recordMetric(`${name}_error`, duration, { ...tags, error: 'true' });
			throw error;
		}
	}

	public generateReport(timeRangeMs: number = 3600000): PerformanceReport {
		// Default 1 hour
		const now = Date.now();
		const startTime = now - timeRangeMs;

		const relevantMetrics = this.metrics.filter((m) => m.timestamp >= startTime);
		const exceededThresholds: PerformanceThreshold[] = [];
		const warningThresholds: PerformanceThreshold[] = [];

		// Analyze threshold violations
		for (const threshold of this.thresholds) {
			const metricValues = relevantMetrics
				.filter((m) => m.name === threshold.metric)
				.map((m) => m.value);

			if (metricValues.length === 0) continue;

			const maxValue = Math.max(...metricValues);
			const avgValue = metricValues.reduce((a, b) => a + b, 0) / metricValues.length;

			if (maxValue >= threshold.errorThreshold) {
				exceededThresholds.push(threshold);
			} else if (avgValue >= threshold.warningThreshold) {
				warningThresholds.push(threshold);
			}
		}

		// Calculate summary statistics
		const responseTimeMetrics = relevantMetrics.filter(
			(m) => m.name.includes('response_time') || m.name.includes('api_response_time')
		);

		let averageResponseTime = 0;
		let maxResponseTime = 0;
		let minResponseTime = Infinity;
		let p95ResponseTime = 0;

		if (responseTimeMetrics.length > 0) {
			const values = responseTimeMetrics.map((m) => m.value).sort((a, b) => a - b);
			averageResponseTime = values.reduce((a, b) => a + b, 0) / values.length;
			maxResponseTime = Math.max(...values);
			minResponseTime = Math.min(...values);

			// P95 (95th percentile)
			const p95Index = Math.floor(values.length * 0.95);
			p95ResponseTime = values[p95Index] || 0;
		}

		const errorMetrics = relevantMetrics.filter((m) => m.name.includes('_error'));
		const totalOperations = relevantMetrics.length;
		const errorRate = totalOperations > 0 ? (errorMetrics.length / totalOperations) * 100 : 0;

		return {
			period: {
				start: startTime,
				end: now,
				duration: timeRangeMs
			},
			metrics: relevantMetrics,
			thresholds: {
				exceeded: exceededThresholds,
				warnings: warningThresholds
			},
			summary: {
				totalMetrics: relevantMetrics.length,
				averageResponseTime,
				maxResponseTime,
				minResponseTime: minResponseTime === Infinity ? 0 : minResponseTime,
				p95ResponseTime,
				errorRate
			}
		};
	}

	public getMetrics(name?: string, timeRangeMs: number = 3600000): PerformanceMetric[] {
		const startTime = Date.now() - timeRangeMs;
		let filtered = this.metrics.filter((m) => m.timestamp >= startTime);

		if (name) {
			filtered = filtered.filter((m) => m.name === name);
		}

		return filtered;
	}

	public clearMetrics(): void {
		this.metrics = [];
	}

	public addReportListener(listener: (report: PerformanceReport) => void): () => void {
		this.listeners.push(listener);
		return () => {
			const index = this.listeners.indexOf(listener);
			if (index > -1) {
				this.listeners.splice(index, 1);
			}
		};
	}

	public generateAlertReport(): { alerts: string[]; warnings: string[] } {
		const report = this.generateReport(300000); // Last 5 minutes
		const alerts: string[] = [];
		const warnings: string[] = [];

		for (const threshold of report.thresholds.exceeded) {
			alerts.push(`${threshold.description}: threshold exceeded (${threshold.errorThreshold}ms)`);
		}

		for (const threshold of report.thresholds.warnings) {
			warnings.push(
				`${threshold.description}: approaching threshold (${threshold.warningThreshold}ms)`
			);
		}

		if (report.summary.errorRate > 10) {
			alerts.push(`High error rate: ${report.summary.errorRate.toFixed(1)}%`);
		}

		if (report.summary.p95ResponseTime > 2000) {
			alerts.push(`Slow P95 response time: ${report.summary.p95ResponseTime.toFixed(0)}ms`);
		}

		return { alerts, warnings };
	}
}

// Global performance monitor instance
export const performanceMonitor = PerformanceMonitor.getInstance();

// Auto-start collection in browser environment
if (typeof window !== 'undefined') {
	performanceMonitor.startCollection();
}

// Export convenience functions
export function measureOperation<T>(
	name: string,
	operation: () => T | Promise<T>,
	tags: Record<string, string> = {}
): T | Promise<T> {
	return performanceMonitor.measureOperation(name, operation, tags);
}

export function measureAsyncOperation<T>(
	name: string,
	operation: () => Promise<T>,
	tags: Record<string, string> = {}
): Promise<T> {
	return performanceMonitor.measureAsyncOperation(name, operation, tags);
}

export function recordMetric(name: string, value: number, tags: Record<string, string> = {}): void {
	return performanceMonitor.recordMetric(name, value, tags);
}
