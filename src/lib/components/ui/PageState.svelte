<script lang="ts">
	import StateNotice from '$lib/components/ui/StateNotice.svelte';

	let {
		kind = 'empty',
		title,
		message,
		actionLabel = null,
		onAction = null,
		embedded = false
	}: {
		kind?: 'loading' | 'empty' | 'error';
		title: string;
		message: string;
		actionLabel?: string | null;
		onAction?: (() => void) | null;
		embedded?: boolean;
	} = $props();

	const tone = $derived.by<'neutral' | 'info' | 'error'>(() => {
		if (kind === 'loading') {
			return 'info';
		}
		if (kind === 'error') {
			return 'error';
		}
		return 'neutral';
	});
</script>

<StateNotice
	{title}
	{message}
	{embedded}
	tone={tone}
	{actionLabel}
	{onAction}
/>
