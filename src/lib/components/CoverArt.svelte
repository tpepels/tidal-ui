<script lang="ts">
	import {
		getCoverFailureBackoffMs,
		getResolvedCoverUrl,
		isCoverInFailureBackoff,
		markCoverFailed,
		markCoverResolved,
		prefetchCoverCandidates
	} from '$lib/utils/coverPipeline';
	import { getNextCoverCandidate, normalizeCoverCandidates } from '$lib/components/coverArtState';

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
	let retryTick = $state(0);
	let retryTimer: ReturnType<typeof setTimeout> | null = null;

	function clearRetryTimer(): void {
		if (retryTimer) {
			clearTimeout(retryTimer);
			retryTimer = null;
		}
	}

	$effect(() => {
		const runToken = retryTick;
		clearRetryTimer();
		const normalized = normalizeCoverCandidates(candidates);
		if (!cacheKey || normalized.length === 0) {
			activeSrc = null;
			activeIndex = 0;
			failed = true;
			return () => {
				clearRetryTimer();
			};
		}

			const resolved = getResolvedCoverUrl(cacheKey);
			if (resolved) {
				const resolvedIndex = normalized.indexOf(resolved);
				activeIndex = resolvedIndex >= 0 ? resolvedIndex : -1;
				activeSrc = resolved;
				failed = false;
				void prefetchCoverCandidates([{ cacheKey, candidates: normalized }]);
				return;
			}

		if (isCoverInFailureBackoff(cacheKey)) {
			activeSrc = null;
			activeIndex = 0;
			failed = true;
			const backoffMs = getCoverFailureBackoffMs(cacheKey);
			if (backoffMs > 0) {
				retryTimer = setTimeout(() => {
					if (retryTick !== runToken) {
						return;
					}
					retryTick += 1;
				}, backoffMs);
			}
			return () => {
				clearRetryTimer();
			};
		}

		activeIndex = 0;
		activeSrc = normalized[0] ?? null;
		failed = !activeSrc;
		void prefetchCoverCandidates([{ cacheKey, candidates: normalized }]);

		return () => {
			clearRetryTimer();
		};
	});

	function handleLoad(): void {
		if (!activeSrc || !cacheKey) return;
		markCoverResolved(cacheKey, activeSrc);
		failed = false;
		clearRetryTimer();
	}

	function handleError(): void {
		const normalized = normalizeCoverCandidates(candidates);
		const nextCandidate = getNextCoverCandidate(normalized, activeIndex);
		if (!nextCandidate.exhausted && nextCandidate.nextSrc) {
			activeIndex = nextCandidate.nextIndex;
			activeSrc = nextCandidate.nextSrc;
			return;
		}

		if (cacheKey) {
			markCoverFailed(cacheKey);
		}
		failed = true;
		activeSrc = null;
		retryTick += 1;
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
