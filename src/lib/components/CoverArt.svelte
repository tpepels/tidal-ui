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
		fallbackClass = 'cover-art-fallback',
		fallbackLabel = 'No artwork',
		loading = 'lazy',
		decoding = 'async'
	}: Props = $props();

	let activeSrc = $state<string | null>(null);
	let activeIndex = $state(0);
	let failed = $state(false);
	let isLoaded = $state(false);
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
		isLoaded = true;
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
		isLoaded = true;
		retryTick += 1;
	}

	$effect(() => {
		activeSrc;
		isLoaded = false;
	});
</script>

{#if !failed && activeSrc}
	<img
		src={activeSrc}
		{alt}
		class={`cover-art-image ${className} ${isLoaded ? 'cover-art-image--ready' : 'cover-art-image--pending'}`.trim()}
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

<style>
	.cover-art-image {
		transition: opacity var(--ui-motion-medium, 200ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1));
	}

	.cover-art-image--pending {
		opacity: 0;
	}

	.cover-art-image--ready {
		opacity: 1;
	}

	.cover-art-fallback {
		display: flex;
		height: 100%;
		width: 100%;
		align-items: center;
		justify-content: center;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: rgba(170, 170, 170, 0.92);
		font-size: 0.78rem;
	}

	@media (prefers-reduced-motion: reduce) {
		.cover-art-image {
			animation: none !important;
			transition: none !important;
			transform: none !important;
		}
	}
</style>
