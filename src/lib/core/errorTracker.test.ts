import { describe, it, expect } from 'vitest';
import { errorTracker } from './errorTracker';

describe('ErrorTracker drilldown filtering', () => {
	it('filters by domain and correlationId with limit', () => {
		errorTracker.clearErrors();

		errorTracker.trackError(new Error('Download failed'), {
			domain: 'download',
			correlationId: 'corr-1'
		});
		errorTracker.trackError(new Error('Playback failed'), {
			domain: 'playback',
			correlationId: 'corr-2'
		});
		errorTracker.trackError(new Error('Download failed again'), {
			domain: 'download',
			correlationId: 'corr-1'
		});

		const filtered = errorTracker.getErrors({
			limit: 1,
			domain: 'download',
			correlationId: 'corr-1'
		});

		expect(filtered).toHaveLength(1);
		expect(filtered[0]?.context?.domain).toBe('download');
		expect(filtered[0]?.context?.correlationId).toBe('corr-1');
	});
});
