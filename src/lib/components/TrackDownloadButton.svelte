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
	class={`inline-flex items-center justify-center rounded-full border border-white/10 bg-white/[0.02] p-2 text-gray-300 transition-[color,background-color,border-color] duration-200 ease-[cubic-bezier(0.2,0,0,1)] hover:border-white/15 hover:bg-white/[0.05] hover:text-white ${className}`.trim()}
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

<style>
	@media (prefers-reduced-motion: reduce) {
		button {
			animation: none !important;
			transition: none !important;
			transform: none !important;
		}
	}
</style>
