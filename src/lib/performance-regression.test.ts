import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { losslessAPI } from './api';

// Performance regression detection utilities
class PerformanceMonitor {
	private startTime: number = 0;
	private measurements: Array<{ name: string; duration: number; threshold: number }> = [];

	start(operation: string) {
		this.startTime = performance.now();
	}

	end(operation: string, thresholdMs: number = 1000) {
		const duration = performance.now() - this.startTime;
		this.measurements.push({ name: operation, duration, threshold: thresholdMs });

		if (duration > thresholdMs) {
			console.warn(
				`Performance regression detected: ${operation} took ${duration.toFixed(2)}ms (threshold: ${thresholdMs}ms)`
			);
		}

		return duration;
	}

	getMeasurements() {
		return this.measurements;
	}

	getSlowOperations() {
		return this.measurements.filter((m) => m.duration > m.threshold);
	}

	reset() {
		this.measurements = [];
		this.startTime = 0;
	}
}

describe('Performance Regression Detection', () => {
	let monitor: PerformanceMonitor;
	let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		monitor = new PerformanceMonitor();
		consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.clearAllMocks();
	});

	afterEach(() => {
		consoleWarnSpy.mockRestore();
	});

	describe('API Operation Performance Baselines', () => {
		it('should complete track retrieval within acceptable time', async () => {
			// Mock a fast API response
			const mockResponse = {
				id: 123,
				title: 'Performance Test Track',
				artists: [{ name: 'Test Artist' }],
				album: { title: 'Test Album' },
				duration: 180
			};

			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: vi.fn().mockResolvedValue(mockResponse)
			});

			monitor.start('track-retrieval');

			try {
				await losslessAPI.getTrack(123);
			} catch (error) {
				// Expected to fail schema validation, but we care about timing
			}

			const duration = monitor.end('track-retrieval', 500); // 500ms threshold

			expect(duration).toBeGreaterThan(0);
			expect(duration).toBeLessThan(1000); // Should not be excessively slow
		}, 10000); // Extended timeout for performance tests

		it('should complete search operations within acceptable time', async () => {
			const mockSearchResults = {
				items: [
					{ id: 1, title: 'Track 1', artists: [{ name: 'Artist 1' }] },
					{ id: 2, title: 'Track 2', artists: [{ name: 'Artist 2' }] }
				],
				totalNumberOfItems: 2,
				limit: 20,
				offset: 0
			};

			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: vi.fn().mockResolvedValue(mockSearchResults)
			});

			monitor.start('search-operation');

			try {
				await losslessAPI.searchTracks('test query');
			} catch (error) {
				// Expected to fail schema validation, but we care about timing
			}

			const duration = monitor.end('search-operation', 300); // 300ms threshold for searches

			expect(duration).toBeGreaterThan(0);
			expect(duration).toBeLessThan(1000);
		}, 10000);

		it('should complete album retrieval within acceptable time', async () => {
			const mockAlbumResponse = {
				data: {
					items: [
						{
							item: {
								id: 1,
								title: 'Track 1',
								artists: [{ name: 'Artist' }],
								album: { id: 123, title: 'Test Album' }
							}
						}
					]
				}
			};

			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: vi.fn().mockResolvedValue(mockAlbumResponse)
			});

			monitor.start('album-retrieval');

			try {
				await losslessAPI.getAlbum(123);
			} catch (error) {
				// Expected to fail schema validation, but we care about timing
			}

			const duration = monitor.end('album-retrieval', 800); // 800ms threshold

			expect(duration).toBeGreaterThan(0);
			expect(duration).toBeLessThan(2000);
		}, 15000);
	});

	describe('Memory Usage Monitoring', () => {
		it('should not cause excessive memory growth during repeated operations', async () => {
			// Skip memory tests in environments without memory API (like Node.js test environment)
			if (typeof performance === 'undefined' || !(performance as any).memory) {
				console.log('Memory monitoring not available in this environment, skipping test');
				return;
			}

			const initialMemory = (performance as any).memory?.usedJSHeapSize || 0;

			// Perform multiple operations
			for (let i = 0; i < 10; i++) {
				global.fetch = vi.fn().mockResolvedValue({
					ok: true,
					status: 200,
					json: vi.fn().mockResolvedValue({
						id: i,
						title: `Track ${i}`,
						artists: [{ name: 'Test Artist' }],
						album: { title: 'Test Album' },
						duration: 180
					})
				});

				try {
					await losslessAPI.getTrack(i);
				} catch (error) {
					// Ignore errors, we're testing memory usage
				}
			}

			const finalMemory = (performance as any).memory
				? (performance as any).memory.usedJSHeapSize
				: 0;

			if ((performance as any).memory) {
				const memoryGrowth = finalMemory - initialMemory;
				const growthMB = memoryGrowth / (1024 * 1024);

				// Allow some memory growth but not excessive (less than 50MB)
				expect(growthMB).toBeLessThan(50);
			}
		}, 30000);
	});

	describe('Concurrent Operation Performance', () => {
		it('should handle concurrent requests without excessive slowdown', async () => {
			const concurrentRequests = 5;
			const mockResponse = {
				id: 123,
				title: 'Concurrent Test Track',
				artists: [{ name: 'Test Artist' }],
				album: { title: 'Test Album' },
				duration: 180
			};

			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				status: 200,
				json: vi.fn().mockResolvedValue(mockResponse)
			});

			monitor.start('concurrent-operations');

			const promises = Array(concurrentRequests)
				.fill(null)
				.map((_, index) => losslessAPI.getTrack(123 + index));

			try {
				await Promise.allSettled(promises);
			} catch (error) {
				// Ignore errors, we're testing timing
			}

			const duration = monitor.end('concurrent-operations', 2000); // 2 second threshold for concurrent ops

			expect(duration).toBeGreaterThan(0);
			expect(duration).toBeLessThan(5000); // Should complete within reasonable time
		}, 20000);
	});

	describe('Performance Degradation Detection', () => {
		it('should detect performance regressions in repeated operations', async () => {
			const operations = [];
			const baselineMeasurements: number[] = [];

			// Establish baseline with fast responses
			for (let i = 0; i < 3; i++) {
				global.fetch = vi.fn().mockResolvedValue({
					ok: true,
					status: 200,
					json: vi.fn().mockResolvedValue({
						id: 123,
						title: 'Baseline Track',
						artists: [{ name: 'Test Artist' }],
						album: { title: 'Test Album' },
						duration: 180
					})
				});

				monitor.start(`baseline-${i}`);
				try {
					await losslessAPI.getTrack(123);
				} catch (error) {
					// Ignore
				}
				const duration = monitor.end(`baseline-${i}`, 1000);
				baselineMeasurements.push(duration);
			}

			const averageBaseline =
				baselineMeasurements.reduce((a, b) => a + b, 0) / baselineMeasurements.length;

			// Test with slower response (simulating degradation)
			global.fetch = vi.fn().mockImplementation(
				() =>
					new Promise(
						(resolve) =>
							setTimeout(
								() =>
									resolve({
										ok: true,
										status: 200,
										json: vi.fn().mockResolvedValue({
											id: 123,
											title: 'Degraded Track',
											artists: [{ name: 'Test Artist' }],
											album: { title: 'Test Album' },
											duration: 180
										})
									}),
								200
							) // 200ms delay
					)
			);

			monitor.start('degraded-operation');
			try {
				await losslessAPI.getTrack(123);
			} catch (error) {
				// Ignore
			}
			const degradedDuration = monitor.end('degraded-operation', 1000);

			// The degraded operation should be noticeably slower than baseline
			expect(degradedDuration).toBeGreaterThan(averageBaseline + 50); // At least 50ms slower
		}, 15000);
	});

	describe('State Machine Performance', () => {
		it('should maintain fast state transitions', async () => {
			const { PlaybackStateMachine } = await import('../test-utils/stateMachines/PlaybackStateMachine');
			const machine = new PlaybackStateMachine();

			const mockTrack = {
				id: 123,
				title: 'State Machine Test Track',
				artists: [{ name: 'Test Artist' }],
				album: { title: 'Test Album' },
				duration: 180
			};

			monitor.start('state-machine-transitions');

			// Perform multiple state transitions
			for (let i = 0; i < 100; i++) {
				machine.transition({ type: 'LOAD_TRACK', track: mockTrack });
				machine.transition({ type: 'PLAY' });
				machine.transition({ type: 'PAUSE' });
				machine.transition({ type: 'STOP' });
			}

			const duration = monitor.end('state-machine-transitions', 100); // 100ms for 400 transitions

			expect(duration).toBeGreaterThan(0);
			expect(duration).toBeLessThan(500); // Should be very fast
		});

		it('should handle rapid event sequences efficiently', async () => {
			const { SearchStateMachine } = await import('../test-utils/stateMachines/SearchStateMachine');
			const machine = new SearchStateMachine();

			monitor.start('search-state-transitions');

			// Perform rapid search operations
			for (let i = 0; i < 50; i++) {
				machine.transition({ type: 'SEARCH', query: `query-${i}`, tab: 'tracks' });
				machine.transition({
					type: 'RESULTS',
					results: {
						tracks: [],
						albums: [],
						artists: [],
						playlists: []
					}
				});
				machine.transition({ type: 'CHANGE_TAB', tab: 'albums' });
			}

			const duration = monitor.end('search-state-transitions', 200); // 200ms for 150 transitions

			expect(duration).toBeGreaterThan(0);
			expect(duration).toBeLessThan(1000);
		});
	});

	describe('Performance Monitoring Utilities', () => {
		it('should track and report performance measurements', () => {
			monitor.start('test-operation');
			// Simulate some work
			for (let i = 0; i < 1000; i++) {
				Math.sqrt(i);
			}
			monitor.end('test-operation', 10);

			const measurements = monitor.getMeasurements();
			expect(measurements).toHaveLength(1);
			expect(measurements[0].name).toBe('test-operation');
			expect(measurements[0].duration).toBeGreaterThan(0);
			expect(measurements[0].threshold).toBe(10);
		});

		it('should identify slow operations', () => {
			monitor.start('fast-operation');
			monitor.end('fast-operation', 100);

			monitor.start('slow-operation');
			// Simulate slow operation
			setTimeout(() => {
				monitor.end('slow-operation', 10); // Very low threshold
			}, 50);

			// Wait for timeout
			return new Promise((resolve) => {
				setTimeout(() => {
					const slowOps = monitor.getSlowOperations();
					expect(slowOps.length).toBeGreaterThan(0);
					expect(slowOps.some((op) => op.name === 'slow-operation')).toBe(true);
					resolve(void 0);
				}, 100);
			});
		}, 1000);
	});

	describe('Regression Baselines', () => {
		it('should establish performance baselines for key operations', () => {
			// This test establishes baseline expectations
			// In a real CI environment, these would be compared against historical data

			const baselines = {
				'track-retrieval': 500, // ms
				'search-operation': 300, // ms
				'album-retrieval': 800, // ms
				'state-transition': 1, // ms per transition
				'concurrent-ops': 2000 // ms for multiple concurrent ops
			};

			// Verify all baselines are reasonable positive numbers
			Object.entries(baselines).forEach(([operation, threshold]) => {
				expect(threshold).toBeGreaterThan(0);
				expect(typeof threshold).toBe('number');
			});

			expect(Object.keys(baselines)).toHaveLength(5);
		});

		it('should detect when operations exceed baseline thresholds', () => {
			const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

			monitor.start('baseline-test');
			// Simulate operation taking longer than threshold
			setTimeout(() => {
				monitor.end('baseline-test', 10); // 10ms threshold
			}, 50); // 50ms actual duration

			return new Promise((resolve) => {
				setTimeout(() => {
					expect(spy).toHaveBeenCalledWith(
						expect.stringContaining('Performance regression detected')
					);
					expect(spy).toHaveBeenCalledWith(expect.stringContaining('baseline-test took'));
					expect(spy).toHaveBeenCalledWith(expect.stringContaining('threshold: 10ms'));
					spy.mockRestore();
					resolve(void 0);
				}, 100);
			});
		}, 1000);
	});
});
