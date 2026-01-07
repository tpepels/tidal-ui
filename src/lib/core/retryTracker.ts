export type RetryEvent = {
	id: string;
	timestamp: number;
	attempt: number;
	delayMs: number;
	operation?: string;
	url?: string;
	component?: string;
	errorMessage?: string;
};

export type RetrySummary = {
	total: number;
	recent: RetryEvent[];
};

const MAX_EVENTS = 200;
const STORAGE_KEY = 'tidal-ui.retry-events';

let events: RetryEvent[] = [];

const loadPersisted = () => {
	if (typeof window === 'undefined') return;
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) return;
		const parsed = JSON.parse(raw) as RetryEvent[];
		if (Array.isArray(parsed)) {
			events = parsed;
		}
	} catch {
		// Ignore persisted retry load errors.
	}
};

const persist = () => {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_EVENTS)));
	} catch {
		// Ignore persistence errors.
	}
};

export const trackRetry = (event: Omit<RetryEvent, 'id' | 'timestamp'>): void => {
	if (events.length === 0) {
		loadPersisted();
	}
	const entry: RetryEvent = {
		...event,
		id: `retry-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
		timestamp: Date.now()
	};
	events.push(entry);
	if (events.length > MAX_EVENTS) {
		events = events.slice(-MAX_EVENTS);
	}
	persist();
};

export const getRetrySummary = (timeRangeMs = 3600000): RetrySummary => {
	if (events.length === 0) {
		loadPersisted();
	}
	const since = Date.now() - timeRangeMs;
	const recent = events.filter((event) => event.timestamp >= since);
	return {
		total: recent.length,
		recent: recent.slice(-5)
	};
};
