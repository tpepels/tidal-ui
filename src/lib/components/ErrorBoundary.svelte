<script lang="ts">
	import { onMount, type Snippet } from 'svelte';
	import { InvariantViolationError } from '$lib/core/invariants';
	import { logger } from '$lib/core/logger';
	import { errorTracker } from '$lib/core/errorTracker';
	import AppDialog from '$lib/components/ui/AppDialog.svelte';

	interface Props {
		children?: Snippet;
		showDetails?: boolean;
	}

	let { children, showDetails = false }: Props = $props();
	let error = $state<Error | null>(null);
	let errorId = $state('');
	let errorTitle = $state('Something went wrong');

	function generateErrorId(): string {
		return `error-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
	}

	function handleError(err: unknown, context?: unknown) {
		const processedError = err instanceof Error ? err : new Error(String(err));
		errorId = generateErrorId();

		// Track error with error tracker
		const trackedErrorId = errorTracker.trackError(processedError, {
			component: 'ErrorBoundary',
			source: 'error-boundary',
			context,
			userAgent: navigator.userAgent,
			url: window.location.href,
			boundaryId: errorId
		});

		error = processedError;
		errorTitle =
			processedError instanceof InvariantViolationError
				? 'Application state inconsistency detected'
				: 'Something went wrong';

		// Structured logging
		logger.error('Error boundary caught error', {
			component: 'ErrorBoundary',
			errorId: trackedErrorId,
			boundaryId: errorId,
			error: processedError,
			context,
			userAgent: navigator.userAgent,
			url: window.location.href
		});

		// Handle invariant violations specially
		if (processedError instanceof InvariantViolationError) {
			logger.error('Invariant violation detected', {
				component: 'ErrorBoundary',
				errorId: trackedErrorId,
				boundaryId: errorId,
				error: processedError,
				invariantContext: processedError.context
			});
		}

		logger.error('Application error occurred', {
			component: 'ErrorBoundary',
			errorId: trackedErrorId,
			boundaryId: errorId,
			error: processedError,
			context
		});
	}

	function resetError() {
		error = null;
		errorId = '';
		errorTitle = 'Something went wrong';
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

{#if children}
	{@render children()}
{/if}

<AppDialog
	open={Boolean(error)}
	title={errorTitle}
	description={error ? `${error.message} Check the console for details.` : null}
	tone="danger"
	dialogRole="alertdialog"
	initialFocusSelector='[data-dialog-action="reload"]'
	closeOnEscape={false}
	onClose={resetError}
>
	{#if showDetails && error}
		<details class="error-details">
			<summary>Error Details (for developers)</summary>
			<pre class="error-stack">{error.stack}</pre>
			<p class="error-id">Error ID: {errorId}</p>
		</details>
	{/if}
	{#snippet actions()}
		<button
			type="button"
			class="ui-chip-button"
			data-dialog-action="retry"
			onclick={resetError}
		>
			Try Again
		</button>
		<button
			type="button"
			class="ui-chip-button"
			data-tone="secondary"
			data-dialog-action="reload"
			onclick={() => window.location.reload()}
		>
			Reload App
		</button>
	{/snippet}
</AppDialog>
