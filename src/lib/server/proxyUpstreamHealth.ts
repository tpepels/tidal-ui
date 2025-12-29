type UpstreamFailureState = {
	failures: number;
	nextRetryAt: number;
};

const UPSTREAM_BASE_BACKOFF_MS = 5_000;
const UPSTREAM_MAX_BACKOFF_MS = 300_000;
const UPSTREAM_BACKOFF_MULTIPLIER = 3;
const UPSTREAM_FAILURE_LOG_TTL_MS = 10_000;

const upstreamFailureStates = new Map<string, UpstreamFailureState>();
const upstreamFailureLogTimestamps = new Map<string, number>();

function calculateBackoffMs(failures: number): number {
	const exponent = Math.max(0, failures - 1);
	const backoff = UPSTREAM_BASE_BACKOFF_MS * UPSTREAM_BACKOFF_MULTIPLIER ** exponent;
	return Math.min(backoff, UPSTREAM_MAX_BACKOFF_MS);
}

export function markUpstreamUnhealthy(origin: string): void {
	const existing = upstreamFailureStates.get(origin);
	const failures = (existing?.failures ?? 0) + 1;
	const backoffMs = calculateBackoffMs(failures);
	upstreamFailureStates.set(origin, {
		failures,
		nextRetryAt: Date.now() + backoffMs
	});
}

export function isUpstreamHealthy(origin: string): boolean {
	const state = upstreamFailureStates.get(origin);
	if (!state) return true;
	if (Date.now() >= state.nextRetryAt) {
		upstreamFailureStates.delete(origin);
		return true;
	}
	return false;
}

export function logUpstreamSuppressed(origin: string): void {
	const lastLog = upstreamFailureLogTimestamps.get(origin) ?? 0;
	const now = Date.now();
	if (now - lastLog < UPSTREAM_FAILURE_LOG_TTL_MS) {
		return;
	}
	const state = upstreamFailureStates.get(origin);
	const retryInMs = state ? Math.max(0, state.nextRetryAt - now) : 0;
	upstreamFailureLogTimestamps.set(origin, now);
	console.warn(
		`Proxy skipping unhealthy upstream: ${origin} (retry in ${Math.ceil(retryInMs / 1000)}s)`
	);
}
