import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import ErrorBoundary from './ErrorBoundary.svelte';
import { InvariantViolationError } from '$lib/core/invariants';

// Mock the toasts store
vi.mock('$lib/stores/toasts', () => ({
	toasts: {
		error: vi.fn()
	}
}));

describe('ErrorBoundary Component', () => {
	let toastsErrorMock: any;

	beforeEach(() => {
		cleanup();
		vi.clearAllMocks();
		toastsErrorMock = vi.mocked(require('$lib/stores/toasts').toasts.error);
	});

	describe('Normal Operation', () => {
		it('should render children when no error occurs', async () => {
			render(ErrorBoundary, {
				props: {
					children: () => 'Test Content'
				}
			});

			await tick();

			expect(screen.getByText('Test Content')).toBeInTheDocument();
		});

		it('should not show error UI initially', async () => {
			render(ErrorBoundary, {
				props: {
					children: () => 'Normal Content'
				}
			});

			await tick();

			expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
			expect(screen.getByText('Normal Content')).toBeInTheDocument();
		});
	});

	describe('Error Handling', () => {
		it('should catch and display errors from child components', async () => {
			const ThrowingComponent = () => {
				throw new Error('Test error from child');
			};

			render(ErrorBoundary, {
				props: {
					children: ThrowingComponent
				}
			});

			await tick();

			expect(screen.getByText('Something went wrong')).toBeInTheDocument();
			expect(screen.getByText('Test error from child')).toBeInTheDocument();
			expect(screen.getByText('Check the console for details.')).toBeInTheDocument();
		});

		it('should generate unique error IDs for each error', async () => {
			const ThrowingComponent = () => {
				throw new Error('Error 1');
			};

			const { rerender } = render(ErrorBoundary, {
				props: {
					children: ThrowingComponent
				}
			});

			await tick();

			const errorId1 = screen.getByText(/Error ID:/).textContent;

			// Create another error
			const ThrowingComponent2 = () => {
				throw new Error('Error 2');
			};

			rerender({
				children: ThrowingComponent2
			});

			await tick();

			const errorId2 = screen.getByText(/Error ID:/).textContent;

			expect(errorId1).not.toBe(errorId2);
			expect(errorId1).toMatch(/Error ID: error-\d+-[a-z0-9]+/);
			expect(errorId2).toMatch(/Error ID: error-\d+-[a-z0-9]+/);
		});

		it('should handle non-Error objects gracefully', async () => {
			const ThrowingComponent = () => {
				throw 'String error';
			};

			render(ErrorBoundary, {
				props: {
					children: ThrowingComponent
				}
			});

			await tick();

			expect(screen.getByText('Something went wrong')).toBeInTheDocument();
			expect(screen.getByText('String error')).toBeInTheDocument();
		});

		it('should show error details when showDetails is true', async () => {
			const ThrowingComponent = () => {
				throw new Error('Detailed error');
			};

			render(ErrorBoundary, {
				props: {
					children: ThrowingComponent,
					showDetails: true
				}
			});

			await tick();

			expect(screen.getByText('Error Details (for developers)')).toBeInTheDocument();
			expect(screen.getByText(/Error ID:/)).toBeInTheDocument();
		});

		it('should hide error details when showDetails is false', async () => {
			const ThrowingComponent = () => {
				throw new Error('Hidden error');
			};

			render(ErrorBoundary, {
				props: {
					children: ThrowingComponent,
					showDetails: false
				}
			});

			await tick();

			expect(screen.queryByText('Error Details (for developers)')).not.toBeInTheDocument();
		});
	});

	describe('Invariant Violation Handling', () => {
		it('should handle InvariantViolationError specially', async () => {
			const invariantError = new InvariantViolationError('Critical invariant violated', {
				component: 'TestComponent',
				state: 'invalid'
			});

			const ThrowingComponent = () => {
				throw invariantError;
			};

			render(ErrorBoundary, {
				props: {
					children: ThrowingComponent
				}
			});

			await tick();

			// Should show special invariant violation message
			expect(toastsErrorMock).toHaveBeenCalledWith('Application state inconsistency detected', {
				action: {
					label: 'Reload',
					handler: expect.any(Function)
				}
			});

			// Should not show regular error UI for invariant violations
			expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
		});

		it('should include context in invariant violation logging', async () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const invariantError = new InvariantViolationError('Test invariant failure', {
				component: 'Test',
				value: 42
			});

			const ThrowingComponent = () => {
				throw invariantError;
			};

			render(ErrorBoundary, {
				props: {
					children: ThrowingComponent
				}
			});

			await tick();

			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringMatching(/\[ErrorBoundary:error-\d+-[a-z0-9]+\]/),
				invariantError,
				undefined
			);
			expect(consoleSpy).toHaveBeenCalledWith('[Invariant Violation]', {
				component: 'Test',
				value: 42
			});

			consoleSpy.mockRestore();
		});
	});

	describe('Global Error Handling', () => {
		it('should catch unhandled errors', async () => {
			render(ErrorBoundary, {
				props: {
					children: () => 'Test Content'
				}
			});

			await tick();

			// Simulate a global error
			const errorEvent = new ErrorEvent('error', {
				error: new Error('Global error'),
				message: 'Global error',
				filename: 'test.js',
				lineno: 42,
				colno: 10
			});

			window.dispatchEvent(errorEvent);

			await tick();

			expect(screen.getByText('Something went wrong')).toBeInTheDocument();
			expect(screen.getByText('Global error')).toBeInTheDocument();
		});

		it('should catch unhandled promise rejections', async () => {
			render(ErrorBoundary, {
				props: {
					children: () => 'Test Content'
				}
			});

			await tick();

			// Simulate an unhandled promise rejection
			const rejectionEvent = new PromiseRejectionEvent('unhandledrejection', {
				reason: new Error('Promise rejection'),
				promise: Promise.reject(new Error('Promise rejection'))
			});

			window.dispatchEvent(rejectionEvent);

			await tick();

			expect(screen.getByText('Something went wrong')).toBeInTheDocument();
			expect(screen.getByText('Promise rejection')).toBeInTheDocument();
		});

		it('should handle non-Error global errors', async () => {
			render(ErrorBoundary, {
				props: {
					children: () => 'Test Content'
				}
			});

			await tick();

			// Simulate a global error with string
			const errorEvent = new ErrorEvent('error', {
				error: 'String error',
				message: 'String error'
			});

			window.dispatchEvent(errorEvent);

			await tick();

			expect(screen.getByText('Something went wrong')).toBeInTheDocument();
			expect(screen.getByText('String error')).toBeInTheDocument();
		});
	});

	describe('Recovery', () => {
		it('should allow recovery with Try Again button', async () => {
			const ThrowingComponent = () => {
				throw new Error('Recoverable error');
			};

			render(ErrorBoundary, {
				props: {
					children: ThrowingComponent
				}
			});

			await tick();

			expect(screen.getByText('Something went wrong')).toBeInTheDocument();

			// Click Try Again
			const tryAgainButton = screen.getByText('Try Again');
			await fireEvent.click(tryAgainButton);

			await tick();

			// Should show the error again since the component still throws
			expect(screen.getByText('Something went wrong')).toBeInTheDocument();
		});

		it('should reset error state when Try Again is clicked', async () => {
			let shouldThrow = true;

			const ConditionalThrowingComponent = () => {
				if (shouldThrow) {
					throw new Error('Conditional error');
				}
				return 'Recovered Content';
			};

			const { rerender } = render(ErrorBoundary, {
				props: {
					children: ConditionalThrowingComponent
				}
			});

			await tick();

			expect(screen.getByText('Something went wrong')).toBeInTheDocument();

			// Stop throwing errors
			shouldThrow = false;

			// Click Try Again
			const tryAgainButton = screen.getByText('Try Again');
			await fireEvent.click(tryAgainButton);

			await tick();

			// Should now show recovered content
			expect(screen.getByText('Recovered Content')).toBeInTheDocument();
			expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
		});
	});

	describe('Toast Integration', () => {
		it('should show toast notifications for regular errors', async () => {
			const ThrowingComponent = () => {
				throw new Error('Toast test error');
			};

			render(ErrorBoundary, {
				props: {
					children: ThrowingComponent
				}
			});

			await tick();

			expect(toastsErrorMock).toHaveBeenCalledWith('Application error: Toast test error', {
				action: {
					label: 'Reload',
					handler: expect.any(Function)
				}
			});
		});

		it('should reload page when toast action is triggered', async () => {
			const reloadSpy = vi.spyOn(window.location, 'reload').mockImplementation(() => {});

			const ThrowingComponent = () => {
				throw new Error('Reload test error');
			};

			render(ErrorBoundary, {
				props: {
					children: ThrowingComponent
				}
			});

			await tick();

			const toastCall = toastsErrorMock.mock.calls[0];
			const reloadHandler = toastCall[1].action.handler;

			reloadHandler();

			expect(reloadSpy).toHaveBeenCalled();

			reloadSpy.mockRestore();
		});
	});

	describe('Component Isolation', () => {
		it('should isolate errors from sibling components', async () => {
			// This test verifies that the error boundary properly isolates errors
			// In a real scenario, we'd have multiple components where only one fails
			const MixedContent = () => `
				<div>Normal content</div>
				${(() => {
					throw new Error('Isolated error');
				})()}
			`;

			render(ErrorBoundary, {
				props: {
					children: MixedContent
				}
			});

			await tick();

			// Should catch the error and show error UI instead of crashing
			expect(screen.getByText('Something went wrong')).toBeInTheDocument();
		});

		it('should maintain boundary state across re-renders', async () => {
			let errorCount = 0;

			const IncrementalErrorComponent = () => {
				errorCount++;
				if (errorCount === 1) {
					throw new Error('First error');
				}
				return `Success after ${errorCount} attempts`;
			};

			const { rerender } = render(ErrorBoundary, {
				props: {
					children: IncrementalErrorComponent
				}
			});

			await tick();

			expect(screen.getByText('Something went wrong')).toBeInTheDocument();
			expect(screen.getByText('First error')).toBeInTheDocument();

			// Re-render should maintain error state
			rerender({
				children: IncrementalErrorComponent
			});

			await tick();

			// Should still show error (component still throws on first render)
			expect(screen.getByText('Something went wrong')).toBeInTheDocument();
		});
	});

	describe('Logging', () => {
		it('should log errors with correlation IDs', async () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			const ThrowingComponent = () => {
				throw new Error('Logged error');
			};

			render(ErrorBoundary, {
				props: {
					children: ThrowingComponent
				}
			});

			await tick();

			expect(consoleSpy).toHaveBeenCalledWith(
				expect.stringMatching(/\[ErrorBoundary:error-\d+-[a-z0-9]+\]/),
				expect.any(Error),
				undefined
			);

			consoleSpy.mockRestore();
		});

		it('should include context in error logging', async () => {
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			const ThrowingComponent = () => {
				throw new Error('Context error');
			};

			render(ErrorBoundary, {
				props: {
					children: ThrowingComponent
				}
			});

			await tick();

			// Should log with error ID and context
			const errorLogCall = consoleSpy.mock.calls.find(
				(call) => call[0] && typeof call[0] === 'string' && call[0].includes('[ErrorBoundary:')
			);

			expect(errorLogCall).toBeDefined();
			expect(errorLogCall![1]).toBeInstanceOf(Error);
			expect(errorLogCall![1].message).toBe('Context error');

			consoleSpy.mockRestore();
		});
	});
});
