import { json, type RequestHandler } from '@sveltejs/kit';
import { logger } from '$lib/core/logger';
import { performanceMonitor } from '$lib/core/performance';

export const GET: RequestHandler = async ({ url }) => {
	const operation = logger.startOperation('metrics_endpoint', {
		component: 'api',
		endpoint: '/api/metrics'
	});

	try {
		const timeRange = parseInt(url.searchParams.get('range') || '3600000'); // Default 1 hour
		const metricsData = collectMetrics(timeRange);

		logger.info('Metrics collected', {
			component: 'api',
			endpoint: '/api/metrics',
			timeRange,
			metricCount: metricsData.recentMetrics.length
		});

		operation.complete(metricsData);

		return json({
			timestamp: Date.now(),
			timeRange,
			...metricsData
		});
	} catch (error) {
		logger.error('Metrics collection failed', {
			component: 'api',
			endpoint: '/api/metrics',
			error: error instanceof Error ? error : new Error(String(error))
		});

		operation.fail(error instanceof Error ? error : new Error(String(error)));

		return json(
			{
				error: 'Failed to collect metrics',
				timestamp: Date.now()
			},
			{ status: 500 }
		);
	}
};

function collectMetrics(timeRangeMs: number) {
	const report = performanceMonitor.generateReport(timeRangeMs);

	// Convert metrics to a more API-friendly format
	const metrics = report.metrics.map((metric) => ({
		name: metric.name,
		value: metric.value,
		timestamp: metric.timestamp,
		tags: metric.tags
	}));

	// Add summary statistics
	const summary = {
		totalMetrics: report.summary.totalMetrics,
		averageResponseTime: Math.round(report.summary.averageResponseTime * 100) / 100,
		maxResponseTime: Math.round(report.summary.maxResponseTime * 100) / 100,
		minResponseTime: Math.round(report.summary.minResponseTime * 100) / 100,
		p95ResponseTime: Math.round(report.summary.p95ResponseTime * 100) / 100,
		errorRate: Math.round(report.summary.errorRate * 100) / 100
	};

	// Add threshold information
	const thresholds = {
		exceeded: report.thresholds.exceeded.map((t) => ({
			metric: t.metric,
			warningThreshold: t.warningThreshold,
			errorThreshold: t.errorThreshold,
			description: t.description
		})),
		warnings: report.thresholds.warnings.map((t) => ({
			metric: t.metric,
			warningThreshold: t.warningThreshold,
			errorThreshold: t.errorThreshold,
			description: t.description
		}))
	};

	return {
		summary,
		thresholds,
		recentMetrics: metrics.slice(-100), // Last 100 metrics
		alerts: performanceMonitor.generateAlertReport()
	};
}
