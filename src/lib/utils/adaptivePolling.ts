type AdaptivePollingOptions = {
	run: () => void | Promise<void>;
	visibleIntervalMs: number;
	hiddenIntervalMs?: number;
	pauseWhenHidden?: boolean;
	immediate?: boolean;
	immediateOnVisible?: boolean;
	onSchedule?: (nextPollAt: number, intervalMs: number) => void;
	onPaused?: () => void;
};

export type AdaptivePollingController = {
	start: () => void;
	stop: () => void;
	tick: () => Promise<void>;
};

function isDocumentHidden(): boolean {
	return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function resolveHiddenInterval(options: AdaptivePollingOptions): number {
	if (Number.isFinite(options.hiddenIntervalMs)) {
		return Math.max(options.visibleIntervalMs, options.hiddenIntervalMs ?? options.visibleIntervalMs);
	}
	return Math.max(options.visibleIntervalMs * 4, options.visibleIntervalMs + 1_000);
}

export function createAdaptivePollingController(
	options: AdaptivePollingOptions
): AdaptivePollingController {
	const visibleIntervalMs = Math.max(100, Math.trunc(options.visibleIntervalMs));
	let timer: ReturnType<typeof setTimeout> | null = null;
	let active = false;
	let inFlight = false;

	const clearTimer = (): void => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
	};

	const scheduleNext = (): void => {
		if (!active) {
			return;
		}

		if (options.pauseWhenHidden && isDocumentHidden()) {
			clearTimer();
			options.onPaused?.();
			return;
		}

		const intervalMs = isDocumentHidden()
			? resolveHiddenInterval(options)
			: visibleIntervalMs;
		const nextPollAt = Date.now() + intervalMs;
		options.onSchedule?.(nextPollAt, intervalMs);
		clearTimer();
		timer = setTimeout(() => {
			void tick();
		}, intervalMs);
	};

	const handleVisibilityChange = (): void => {
		if (!active) {
			return;
		}

		clearTimer();
		if (options.pauseWhenHidden && isDocumentHidden()) {
			options.onPaused?.();
			return;
		}

		if (!isDocumentHidden() && options.immediateOnVisible !== false) {
			void tick();
			return;
		}

		scheduleNext();
	};

	const tick = async (): Promise<void> => {
		if (!active) {
			return;
		}
		if (options.pauseWhenHidden && isDocumentHidden()) {
			options.onPaused?.();
			return;
		}
		if (inFlight) {
			scheduleNext();
			return;
		}

		inFlight = true;
		try {
			await options.run();
		} finally {
			inFlight = false;
			scheduleNext();
		}
	};

	const start = (): void => {
		if (active) {
			stop();
		}
		active = true;
		if (typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', handleVisibilityChange);
		}

		if (options.immediate === false) {
			scheduleNext();
			return;
		}

		if (options.pauseWhenHidden && isDocumentHidden()) {
			options.onPaused?.();
			return;
		}

		void tick();
	};

	const stop = (): void => {
		active = false;
		clearTimer();
		if (typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', handleVisibilityChange);
		}
		options.onPaused?.();
	};

	return { start, stop, tick };
}
