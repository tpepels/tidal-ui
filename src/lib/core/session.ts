const SESSION_KEY = 'tidal-ui:session-id';
const STORAGE_PREFIX = 'tidal-ui:';
let cachedSessionId: string | null = null;

const generateSessionId = () =>
	`session-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

export const getSessionId = (): string => {
	if (cachedSessionId) {
		return cachedSessionId;
	}

	if (typeof window === 'undefined') {
		cachedSessionId = 'server';
		return cachedSessionId;
	}

	try {
		const existing = window.sessionStorage.getItem(SESSION_KEY);
		if (existing) {
			cachedSessionId = existing;
			return existing;
		}
	} catch {
		// Ignore sessionStorage failures and fall back to memory.
	}

	const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : generateSessionId();

	try {
		window.sessionStorage.setItem(SESSION_KEY, id);
	} catch {
		// Ignore sessionStorage write failures.
	}

	cachedSessionId = id;
	return id;
};

export const getSessionStorageKey = (key: string): string => {
	const sessionId = getSessionId();
	return `${STORAGE_PREFIX}${sessionId}:${key}`;
};

export const getSessionHeaders = (): Record<string, string> => {
	const sessionId = getSessionId();
	return sessionId ? { 'x-session-id': sessionId } : {};
};
