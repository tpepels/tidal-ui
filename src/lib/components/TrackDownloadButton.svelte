<script lang="ts">
	import { Download, X } from 'lucide-svelte';

	interface Props {
		isDownloading: boolean;
		isCancelled: boolean;
		onDownload: (event: MouseEvent) => void;
		onCancel: (event: MouseEvent) => void;
		title?: string;
		ariaLabel?: string;
		size?: number;
		class?: string;
	}

	let {
		isDownloading,
		isCancelled,
		onDownload,
		onCancel,
		title,
		ariaLabel,
		size = 18,
		class: className = ''
	}: Props = $props();

	const resolvedTitle = $derived(title ?? (isDownloading ? 'Cancel download' : 'Download track'));
	const resolvedLabel = $derived(ariaLabel ?? resolvedTitle);
</script>

<button
	onclick={(event) => (isDownloading ? onCancel(event) : onDownload(event))}
	class={`p-2 text-gray-400 transition-colors hover:text-white ${className}`.trim()}
	title={resolvedTitle}
	aria-label={resolvedLabel}
	aria-busy={isDownloading}
	aria-pressed={isDownloading}
>
	{#if isDownloading}
		<span class="flex h-4 w-4 items-center justify-center">
			{#if isCancelled}
				<X size={Math.max(14, size - 4)} />
			{:else}
				<span class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"></span>
			{/if}
		</span>
	{:else if isCancelled}
		<X size={size} />
	{:else}
		<Download size={size} />
	{/if}
</button>
