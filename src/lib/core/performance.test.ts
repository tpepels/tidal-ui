import { describe, it, expect } from 'vitest';
import { performanceMonitor } from './performance';
import { logger } from './logger';

const getLatestPerformanceEntry = (entries: Array<{ message?: string; context?: Record<string, unknown> }>) => {
	return entries
		.slice()
		.reverse()
		.find((entry) => entry.message?.includes('Performance metric recorded'));
};

describe('PerformanceMonitor correlation id', () => {
	it('tags missing correlation ids explicitly', () => {
		const entries: Array<{ message?: string; context?: Record<string, unknown> }> = [];
		const unsubscribe = logger.addListener((entry) => entries.push(entry));
		logger.setCorrelationId(null);

		performanceMonitor.recordMetric('page_load_time', 1500, { endpoint: 'page_load' });

		unsubscribe();
		const entry = getLatestPerformanceEntry(entries);
		expect(entry?.context?.correlationId).toBe('missing');
		expect(entry?.context?.missingCorrelationId).toBe(true);
	});

	it('preserves provided correlation ids', () => {
		const entries: Array<{ message?: string; context?: Record<string, unknown> }> = [];
		const unsubscribe = logger.addListener((entry) => entries.push(entry));

		performanceMonitor.recordMetric('page_load_time', 1500, {
			endpoint: 'page_load',
			correlationId: 'corr-123'
		});

		unsubscribe();
		const entry = getLatestPerformanceEntry(entries);
		expect(entry?.context?.correlationId).toBe('corr-123');
		expect(entry?.context?.missingCorrelationId).toBe(false);
	});
});
