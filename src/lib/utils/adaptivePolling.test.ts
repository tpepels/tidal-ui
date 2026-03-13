import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAdaptivePollingController } from './adaptivePolling';

describe('adaptivePolling', () => {
	const originalVisibilityState = Object.getOwnPropertyDescriptor(document, 'visibilityState');

	beforeEach(() => {
		vi.useFakeTimers();
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			value: 'visible'
		});
	});

	afterEach(() => {
		vi.useRealTimers();
		if (originalVisibilityState) {
			Object.defineProperty(document, 'visibilityState', originalVisibilityState);
		}
	});

	it('polls immediately and continues on the visible interval', async () => {
		const run = vi.fn(async () => {});
		const controller = createAdaptivePollingController({
			run,
			visibleIntervalMs: 1000
		});

		controller.start();
		await Promise.resolve();
		expect(run).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(1000);
		expect(run).toHaveBeenCalledTimes(2);

		controller.stop();
	});

	it('pauses while hidden and resumes immediately when visible again', async () => {
		const run = vi.fn(async () => {});
		const onPaused = vi.fn();
		const controller = createAdaptivePollingController({
			run,
			visibleIntervalMs: 1000,
			pauseWhenHidden: true,
			onPaused
		});

		controller.start();
		await Promise.resolve();
		expect(run).toHaveBeenCalledTimes(1);

		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			value: 'hidden'
		});
		document.dispatchEvent(new Event('visibilitychange'));

		await vi.advanceTimersByTimeAsync(5000);
		expect(run).toHaveBeenCalledTimes(1);
		expect(onPaused).toHaveBeenCalled();

		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			value: 'visible'
		});
		document.dispatchEvent(new Event('visibilitychange'));
		await Promise.resolve();
		expect(run).toHaveBeenCalledTimes(2);

		controller.stop();
	});
});
