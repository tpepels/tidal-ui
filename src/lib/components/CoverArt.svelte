<script lang="ts">
	import {
		getResolvedCoverUrl,
		isCoverInFailureBackoff,
		markCoverFailed,
		markCoverResolved,
		prefetchCoverCandidates
	} from '$lib/utils/coverPipeline';

	interface Props {
		cacheKey: string;
		candidates: string[];
		alt: string;
		class?: string;
		fallbackClass?: string;
		fallbackLabel?: string;
		loading?: 'lazy' | 'eager';
		decoding?: 'async' | 'sync' | 'auto';
	}

	let {
		cacheKey,
		candidates,
		alt,
		class: className = '',
		fallbackClass = 'flex h-full w-full items-center justify-center bg-gray-800 text-sm text-gray-500',
		fallbackLabel = 'No artwork',
		loading = 'lazy',
		decoding = 'async'
	}: Props = $props();

	let activeSrc = $state<string | null>(null);
	let activeIndex = $state(0);
	let failed = $state(false);

	$effect(() => {
		const normalized = (Array.isArray(candidates) ? candidates : []).filter(
			(value): value is string => typeof value === 'string' && value.length > 0
		);
		if (!cacheKey || normalized.length === 0) {
			activeSrc = null;
			activeIndex = 0;
			failed = true;
			return;
		}

		const resolved = getResolvedCoverUrl(cacheKey);
		if (resolved) {
			const resolvedIndex = normalized.indexOf(resolved);
			activeIndex = resolvedIndex >= 0 ? resolvedIndex : 0;
			activeSrc = resolved;
			failed = false;
			void prefetchCoverCandidates([{ cacheKey, candidates: normalized }]);
			return;
		}

		if (isCoverInFailureBackoff(cacheKey)) {
			activeSrc = null;
			activeIndex = 0;
			failed = true;
			return;
		}

		activeIndex = 0;
		activeSrc = normalized[0] ?? null;
		failed = !activeSrc;
		void prefetchCoverCandidates([{ cacheKey, candidates: normalized }]);
	});

	function handleLoad(): void {
		if (!activeSrc || !cacheKey) return;
		markCoverResolved(cacheKey, activeSrc);
		failed = false;
	}

	function handleError(): void {
		const normalized = (Array.isArray(candidates) ? candidates : []).filter(
			(value): value is string => typeof value === 'string' && value.length > 0
		);
		const nextIndex = activeIndex + 1;
		if (nextIndex < normalized.length) {
			activeIndex = nextIndex;
			activeSrc = normalized[nextIndex] ?? null;
			return;
		}

		if (cacheKey) {
			markCoverFailed(cacheKey);
		}
		failed = true;
		activeSrc = null;
	}
</script>

{#if !failed && activeSrc}
	<img
		src={activeSrc}
		{alt}
		class={className}
		{loading}
		{decoding}
		onerror={handleError}
		onload={handleLoad}
	/>
{:else}
	<div class={fallbackClass}>
		{fallbackLabel}
	</div>
{/if}
