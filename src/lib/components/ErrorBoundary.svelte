<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { toasts } from '$lib/stores/toasts';
	import { InvariantViolationError } from '$lib/core/invariants';

	interface Props {
		children: Snippet;
		showDetails?: boolean;
	}

	let { children, showDetails = false }: Props = $props();
	let error = $state<Error | null>(null);
	let errorId = $state('');

	function generateErrorId(): string {
		return `error-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
	}

	function handleError(err: unknown, context?: unknown) {
		const processedError = err instanceof Error ? err : new Error(String(err));
		errorId = generateErrorId();

		console.error(`[ErrorBoundary:${errorId}]`, processedError, context);

		// Handle invariant violations specially
		if (processedError instanceof InvariantViolationError) {
			console.error('[Invariant Violation]', processedError.context);
			toasts.error('Application state inconsistency detected', {
				action: {
					label: 'Reload',
					handler: () => window.location.reload()
				}
			});
		} else {
			error = processedError;
			toasts.error(`Application error: ${processedError.message}`, {
				action: {
					label: 'Reload',
					handler: () => window.location.reload()
				}
			});
		}

		// TODO: Send telemetry data in production
	}

	function resetError() {
		error = null;
		errorId = '';
	}

	// Catch unhandled errors and promise rejections
	onMount(() => {
		const handleGlobalError = (event: ErrorEvent) => {
			handleError(event.error || new Error(event.message), {
				source: event.filename,
				line: event.lineno,
				column: event.colno
			});
		};

		const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
			handleError(event.reason, { type: 'unhandled-promise-rejection' });
		};

		window.addEventListener('error', handleGlobalError);
		window.addEventListener('unhandledrejection', handleUnhandledRejection);

		return () => {
			window.removeEventListener('error', handleGlobalError);
			window.removeEventListener('unhandledrejection', handleUnhandledRejection);
		};
	});
</script>

{#if error}
	<div class="error-boundary">
		<h2>Something went wrong</h2>
		<p>{error.message}</p>
		<p>Check the console for details.</p>
		{#if showDetails}
			<details class="error-details">
				<summary>Error Details (for developers)</summary>
				<pre class="error-stack">{error.stack}</pre>
				<p class="error-id">Error ID: {errorId}</p>
			</details>
		{/if}
		<div class="error-actions">
			<button onclick={resetError}>Try Again</button>
			<button onclick={() => window.location.reload()}>Reload App</button>
		</div>
	</div>
{:else}
	{@render children()}
{/if}

<style>
	.error-boundary {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.9);
		color: white;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		z-index: 10000;
		padding: 2rem;
		text-align: center;
	}
</style>