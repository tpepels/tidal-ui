import { browser } from '$app/environment';
import type { TrackDownloadStatus, TrackDownloadTask } from '$lib/stores/downloadState';
import type { DownloadStorage } from '$lib/stores/downloadPreferences';

export interface DownloadCacheEntry {
	id: string;
	trackId: number | string;
	title: string;
	subtitle?: string;
	filename: string;
	status: TrackDownloadStatus;
	storage?: DownloadStorage;
	error?: string;
	startedAt: number;
	updatedAt: number;
}

interface DownloadCacheState {
	version: 1;
	entries: DownloadCacheEntry[];
}

interface DownloadCacheOptions {
	storageKey?: string;
	maxEntries?: number;
	maxEntryAgeMs?: number;
}

const STORAGE_VERSION = 1;
const DEFAULT_STORAGE_KEY = 'tidal-ui.downloadCache';
const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_MAX_ENTRY_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null;

const isValidEntry = (value: unknown): value is DownloadCacheEntry => {
	if (!isRecord(value)) return false;
	return (
		typeof value.id === 'string' &&
		(typeof value.trackId === 'number' || typeof value.trackId === 'string') &&
		typeof value.title === 'string' &&
		typeof value.filename === 'string' &&
		typeof value.status === 'string' &&
		typeof value.startedAt === 'number' &&
		typeof value.updatedAt === 'number'
	);
};

const normalizeEntries = (
	entries: DownloadCacheEntry[],
	now: number,
	maxEntryAgeMs: number
): { entries: DownloadCacheEntry[]; changed: boolean } => {
	let changed = false;
	const next: DownloadCacheEntry[] = [];

	for (const entry of entries) {
		let candidate = entry;
		if (candidate.status === 'running') {
			candidate = {
				...candidate,
				status: 'cancelled',
				error: candidate.error ?? 'Session ended before completion',
				updatedAt: now
			};
			changed = true;
		}

		if (now - candidate.updatedAt > maxEntryAgeMs) {
			changed = true;
			continue;
		}

		next.push(candidate);
	}

	return { entries: next, changed };
};

const readState = (storageKey: string, maxEntryAgeMs: number): DownloadCacheState => {
	if (!browser) {
		return { version: STORAGE_VERSION, entries: [] };
	}

	try {
		const raw = localStorage.getItem(storageKey);
		if (!raw) {
			return { version: STORAGE_VERSION, entries: [] };
		}
		const parsed = JSON.parse(raw) as Partial<DownloadCacheState>;
		if (parsed?.version !== STORAGE_VERSION || !Array.isArray(parsed.entries)) {
			return { version: STORAGE_VERSION, entries: [] };
		}

		const validEntries = parsed.entries.filter(isValidEntry) as DownloadCacheEntry[];
		const now = Date.now();
		const normalized = normalizeEntries(validEntries, now, maxEntryAgeMs);
		return {
			version: STORAGE_VERSION,
			entries: normalized.entries
		};
	} catch (error) {
		console.warn('Failed to load download cache state', error);
		return { version: STORAGE_VERSION, entries: [] };
	}
};

export const createDownloadCache = (options?: DownloadCacheOptions) => {
	const storageKey = options?.storageKey ?? DEFAULT_STORAGE_KEY;
	const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
	const maxEntryAgeMs = options?.maxEntryAgeMs ?? DEFAULT_MAX_ENTRY_AGE_MS;
	let state = readState(storageKey, maxEntryAgeMs);

	const persist = () => {
		if (!browser) return;
		try {
			localStorage.setItem(storageKey, JSON.stringify(state));
		} catch (error) {
			console.warn('Failed to persist download cache state', error);
		}
	};

	const setState = (next: DownloadCacheState) => {
		state = next;
		persist();
	};

	const upsertEntry = (entry: DownloadCacheEntry) => {
		const existingIndex = state.entries.findIndex((item) => item.id === entry.id);
		const entries = state.entries.slice();
		if (existingIndex >= 0) {
			entries[existingIndex] = entry;
		} else {
			entries.unshift(entry);
		}

		entries.sort((a, b) => b.updatedAt - a.updatedAt);
		const trimmed = entries.slice(0, maxEntries);
		setState({ version: STORAGE_VERSION, entries: trimmed });
	};

	const updateStatus = (id: string, status: TrackDownloadStatus, error?: string) => {
		const index = state.entries.findIndex((entry) => entry.id === id);
		if (index === -1) return;
		const entry = state.entries[index]!;
		const updated: DownloadCacheEntry = {
			...entry,
			status,
			error: error ?? entry.error,
			updatedAt: Date.now()
		};
		const entries = state.entries.slice();
		entries[index] = updated;
		setState({ version: STORAGE_VERSION, entries });
	};

	return {
		getState: () => state,
		recordStart: (task: TrackDownloadTask) => {
			const entry: DownloadCacheEntry = {
				id: task.id,
				trackId: task.trackId,
				title: task.title,
				subtitle: task.subtitle,
				filename: task.filename,
				status: 'running',
				storage: task.storage,
				error: undefined,
				startedAt: task.startedAt,
				updatedAt: Date.now()
			};
			upsertEntry(entry);
		},
		markCompleted: (id: string) => updateStatus(id, 'completed'),
		markCancelled: (id: string) => updateStatus(id, 'cancelled'),
		markFailed: (id: string, error?: string) => updateStatus(id, 'error', error),
		remove: (id: string) => {
			const entries = state.entries.filter((entry) => entry.id !== id);
			setState({ version: STORAGE_VERSION, entries });
		},
		clear: () => {
			setState({ version: STORAGE_VERSION, entries: [] });
			if (browser) {
				try {
					localStorage.removeItem(storageKey);
				} catch (error) {
					console.warn('Failed to clear download cache state', error);
				}
			}
		}
	};
};

export const downloadCache = createDownloadCache();
