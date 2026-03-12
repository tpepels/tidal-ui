<script lang="ts">
	import PageState from '$lib/components/ui/PageState.svelte';

	export let kind: 'loading' | 'empty' | 'error' = 'loading';
	export let title: string;
	export let message: string;
	export let actionLabel: string | null = null;
	export let onAction: (() => void) | undefined = undefined;
	export let embedded = false;
</script>

<PageState {kind} {title} {message} {actionLabel} {onAction} {embedded} />
