import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const REPORTS_ROOT = path.join(process.cwd(), 'data', 'media-maintenance', 'runs');
const REPORT_RETENTION = Math.max(
	5,
	Number(process.env.MEDIA_MAINTENANCE_REPORT_RETENTION || 100)
);

type ReportEnvelope = {
	runId: string;
	kind: string;
	savedAt: number;
	payload: unknown;
};

async function ensureReportsRoot(): Promise<void> {
	await fs.mkdir(REPORTS_ROOT, { recursive: true });
}

async function enforceRetention(): Promise<void> {
	let entries: Array<{ filePath: string; mtimeMs: number }> = [];
	try {
		const names = await fs.readdir(REPORTS_ROOT);
		entries = await Promise.all(
			names.map(async (name) => {
				const filePath = path.join(REPORTS_ROOT, name);
				const stat = await fs.stat(filePath).catch(() => null);
				return {
					filePath,
					mtimeMs: stat?.mtimeMs ?? 0
				};
			})
		);
	} catch {
		return;
	}

	const sorted = entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
	const stale = sorted.slice(REPORT_RETENTION);
	await Promise.all(
		stale.map(async ({ filePath }) => {
			await fs.rm(filePath, { force: true }).catch(() => {});
		})
	);
}

export async function writeMediaMaintenanceRunReport(options: {
	runId: string;
	kind: 'deduplicate' | 'correct-and-deduplicate' | 'sweep-temporary';
	payload: unknown;
}): Promise<string | null> {
	const runId = options.runId.trim();
	if (!runId) return null;

	await ensureReportsRoot();
	const reportPath = path.join(REPORTS_ROOT, `${runId}.json`);
	const envelope: ReportEnvelope = {
		runId,
		kind: options.kind,
		savedAt: Date.now(),
		payload: options.payload
	};
	try {
		await fs.writeFile(reportPath, JSON.stringify(envelope, null, 2), 'utf8');
		await enforceRetention();
		return reportPath;
	} catch (error) {
		console.warn(
			'[Media Maintenance Reports] Failed to persist run report',
			JSON.stringify({
				runId,
				kind: options.kind,
				reportPath,
				error: error instanceof Error ? error.message : String(error)
			})
		);
		return null;
	}
}
