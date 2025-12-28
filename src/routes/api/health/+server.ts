import { json, type RequestHandler } from '@sveltejs/kit';
import { logger } from '$lib/core/logger';
import { performanceMonitor } from '$lib/core/performance';

export const GET: RequestHandler = async () => {
	const operation = logger.startOperation('health_check', {
		component: 'api',
		endpoint: '/api/health'
	});

	try {
		const healthCheck = await performHealthCheck();

		const statusCode = healthCheck.status === 'healthy' ? 200 : 503;

		logger.info('Health check completed', {
			component: 'api',
			endpoint: '/api/health',
			status: healthCheck.status,
			responseTime: healthCheck.timestamp
		});

		operation.complete(healthCheck);

		return json(healthCheck, { status: statusCode });
	} catch (error) {
		logger.error('Health check failed', {
			component: 'api',
			endpoint: '/api/health',
			error: error instanceof Error ? error : new Error(String(error))
		});

		operation.fail(error instanceof Error ? error : new Error(String(error)));

		return json(
			{
				status: 'unhealthy',
				timestamp: Date.now(),
				error: 'Health check failed',
				details: error instanceof Error ? error.message : String(error)
			},
			{ status: 503 }
		);
	}
};

async function performHealthCheck() {
	const startTime = Date.now();

	// Basic system checks
	const systemHealth = {
		timestamp: Date.now(),
		uptime: process.uptime ? process.uptime() : 0,
		memory: getMemoryUsage(),
		nodeVersion: process.version,
		platform: process.platform
	};

	// Performance metrics
	const performanceReport = performanceMonitor.generateReport(300000); // Last 5 minutes
	const performanceHealth = {
		metricsCollected: performanceReport.summary.totalMetrics,
		averageResponseTime: performanceReport.summary.averageResponseTime,
		maxResponseTime: performanceReport.summary.maxResponseTime,
		errorRate: performanceReport.summary.errorRate,
		thresholdsExceeded: performanceReport.thresholds.exceeded.length,
		thresholdsWarned: performanceReport.thresholds.warnings.length
	};

	// Check for critical issues
	const criticalIssues = [];

	if (performanceHealth.errorRate > 20) {
		criticalIssues.push(`High error rate: ${performanceHealth.errorRate.toFixed(1)}%`);
	}

	if (performanceHealth.maxResponseTime > 10000) {
		// 10 seconds
		criticalIssues.push(`Slow responses: ${performanceHealth.maxResponseTime.toFixed(0)}ms max`);
	}

	if (systemHealth.memory.usagePercent > 90) {
		criticalIssues.push(`High memory usage: ${systemHealth.memory.usagePercent.toFixed(1)}%`);
	}

	const status = criticalIssues.length === 0 ? 'healthy' : 'degraded';
	const responseTime = Date.now() - startTime;

	return {
		status,
		timestamp: Date.now(),
		responseTime,
		system: systemHealth,
		performance: performanceHealth,
		issues: criticalIssues.length > 0 ? criticalIssues : undefined,
		checks: {
			system: 'passed',
			performance: performanceHealth.thresholdsExceeded === 0 ? 'passed' : 'warning',
			memory: systemHealth.memory.usagePercent < 90 ? 'passed' : 'warning'
		}
	};
}

function getMemoryUsage() {
	if (typeof process !== 'undefined' && process.memoryUsage) {
		const usage = process.memoryUsage();
		const totalMB = usage.heapTotal / (1024 * 1024);
		const usedMB = usage.heapUsed / (1024 * 1024);
		const usagePercent = (usedMB / totalMB) * 100;

		return {
			heapUsed: Math.round(usedMB),
			heapTotal: Math.round(totalMB),
			usagePercent: Math.round(usagePercent * 10) / 10
		};
	}

	// Fallback for browser environment
	return {
		heapUsed: 0,
		heapTotal: 0,
		usagePercent: 0
	};
}
