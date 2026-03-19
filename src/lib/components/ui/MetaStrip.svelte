<script lang="ts">
	import type { Snippet } from 'svelte';
	type Tone = 'default' | 'secondary' | 'tertiary';

	let {
		tone = 'default',
		compact = false,
		className = '',
		children
	}: {
		tone?: Tone;
		compact?: boolean;
		className?: string;
		children?: Snippet;
	} = $props();
</script>

<div
	class={`ui-meta-strip ${compact ? 'ui-meta-strip--compact' : ''} ${className}`.trim()}
	data-tone={tone === 'default' ? undefined : tone}
>
	{@render children?.()}
</div>
