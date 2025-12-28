import { json, type RequestHandler } from '@sveltejs/kit';
import { logger } from '$lib/core/logger';
import { errorTracker } from '$lib/core/errorTracker';

export const GET: RequestHandler = async ({ url }) => {
	const operation = logger.startOperation('errors_endpoint', {
		component: 'api',
		endpoint: '/api/errors'
	});

	try {
		const timeRange = parseInt(url.searchParams.get('range') || '3600000'); // Default 1 hour
		const limit = parseInt(url.searchParams.get('limit') || '50');
		const includeSummary = url.searchParams.get('summary') === 'true';

		const errors = errorTracker.getErrors(timeRange);
		const recentErrors = errors.slice(-limit);

		let response: any = {
			timestamp: Date.now(),
			timeRange,
			totalErrors: errors.length,
			returnedErrors: recentErrors.length,
			errors: recentErrors.map((error) => ({
				id: error.id,
				timestamp: error.timestamp,
				message: error.error.message,
				stack: error.stack,
				severity: error.severity,
				frequency: error.frequency,
				context: error.context,
				firstSeen: error.firstSeen,
				lastSeen: error.lastSeen
			}))
		};

		if (includeSummary) {
			response.summary = errorTracker.getErrorSummary(timeRange);
		}

		logger.info('Errors retrieved', {
			component: 'api',
			endpoint: '/api/errors',
			timeRange,
			totalErrors: errors.length,
			returnedErrors: recentErrors.length
		});

		operation.complete(response);

		return json(response);
	} catch (error) {
		logger.error('Errors endpoint failed', {
			component: 'api',
			endpoint: '/api/errors',
			error: error instanceof Error ? error : new Error(String(error))
		});

		operation.fail(error instanceof Error ? error : new Error(String(error)));

		return json(
			{
				error: 'Failed to retrieve errors',
				timestamp: Date.now()
			},
			{ status: 500 }
		);
	}
};

export const DELETE: RequestHandler = async () => {
	const operation = logger.startOperation('clear_errors', {
		component: 'api',
		endpoint: '/api/errors'
	});

	try {
		const beforeCount = errorTracker.getErrors().length;
		errorTracker.clearErrors();

		logger.info('Errors cleared', {
			component: 'api',
			endpoint: '/api/errors',
			clearedCount: beforeCount
		});

		operation.complete({ cleared: beforeCount });

		return json({
			message: 'Errors cleared',
			clearedCount: beforeCount,
			timestamp: Date.now()
		});
	} catch (error) {
		logger.error('Clear errors failed', {
			component: 'api',
			endpoint: '/api/errors',
			error: error instanceof Error ? error : new Error(String(error))
		});

		operation.fail(error instanceof Error ? error : new Error(String(error)));

		return json(
			{
				error: 'Failed to clear errors',
				timestamp: Date.now()
			},
			{ status: 500 }
		);
	}
};
