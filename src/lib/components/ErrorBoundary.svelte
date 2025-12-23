<script lang="ts">
	import { onMount } from 'svelte';
	import { toasts } from '$lib/stores/toasts';

	interface Props {
		children: any;
	}

	let { children }: Props = $props();
	let error = $state<Error | null>(null);

	function handleError(err: any) {
		console.error('Global error boundary caught:', err);
		error = err instanceof Error ? err : new Error(String(err));
		toasts.error(`Application error: ${error.message}`, {
			action: {
				label: 'Reload',
				handler: () => window.location.reload()
			}
		});
	}

	// Catch unhandled errors
	onMount(() => {
		window.onerror = (message, source, lineno, colno, err) => {
			handleError(err || new Error(String(message)));
		};

		window.onunhandledrejection = (event) => {
			handleError(event.reason);
		};
	});
</script>

{#if error}
	<div class="error-boundary">
		<h2>Something went wrong</h2>
		<p>{error.message}</p>
		<p>Check the console for details.</p>
		<button onclick={() => { error = null; window.location.reload(); }}>Reload App</button>
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