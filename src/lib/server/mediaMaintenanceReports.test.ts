import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

describe('mediaMaintenanceReports', () => {
	let tempDir: string;
	let reportsDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tidal-ui-maint-reports-'));
		reportsDir = path.join(tempDir, 'runs');
		vi.resetModules();
		vi.stubEnv('MEDIA_MAINTENANCE_REPORT_RETENTION', '5');
		vi.stubEnv('MEDIA_MAINTENANCE_REPORTS_DIR', reportsDir);
	});

	afterEach(async () => {
		vi.unstubAllEnvs();
		await fs.rm(tempDir, { recursive: true, force: true });
	});

	it('keeps only the latest N persisted maintenance reports', async () => {
		const { writeMediaMaintenanceRunReport } = await import('./mediaMaintenanceReports');
		await writeMediaMaintenanceRunReport({
			runId: 'run-1',
			kind: 'deduplicate',
			payload: { a: 1 }
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		await writeMediaMaintenanceRunReport({
			runId: 'run-2',
			kind: 'deduplicate',
			payload: { a: 2 }
		});
		await new Promise((resolve) => setTimeout(resolve, 10));
		await writeMediaMaintenanceRunReport({ runId: 'run-3', kind: 'deduplicate', payload: { a: 3 } });
		await new Promise((resolve) => setTimeout(resolve, 10));
		await writeMediaMaintenanceRunReport({ runId: 'run-4', kind: 'deduplicate', payload: { a: 4 } });
		await new Promise((resolve) => setTimeout(resolve, 10));
		await writeMediaMaintenanceRunReport({ runId: 'run-5', kind: 'deduplicate', payload: { a: 5 } });
		await new Promise((resolve) => setTimeout(resolve, 10));
		await writeMediaMaintenanceRunReport({ runId: 'run-6', kind: 'deduplicate', payload: { a: 6 } });

		const files = (await fs.readdir(reportsDir)).sort();
		expect(files).toHaveLength(5);
		expect(files).toContain('run-2.json');
		expect(files).toContain('run-6.json');
		expect(files).not.toContain('run-1.json');
	});
});
