<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount, tick } from 'svelte';
	import {
		computeVirtualWindowRange,
		createFullWindowRange,
		resolveResponsiveItemHeight,
		type VirtualWindowRange
	} from '$lib/utils/windowing';

	interface Props {
		items: unknown[];
		itemHeight: number;
		itemHeightMobile?: number;
		mobileBreakpoint?: number;
		overscan?: number;
		threshold?: number;
		id?: string;
		className?: string;
		dataTone?: string | null;
		useContainerScroll?: boolean;
		containerElement?: HTMLDivElement | null;
		row: Snippet<[unknown, number]>;
	}

	let {
		items,
		itemHeight,
		itemHeightMobile = undefined,
		mobileBreakpoint = 640,
		overscan = 8,
		threshold = 40,
		id = undefined,
		className = '',
		dataTone = null,
		useContainerScroll = false,
		containerElement = $bindable<HTMLDivElement | null>(null),
		row
	}: Props = $props();

	let localContainer = $state<HTMLDivElement | null>(null);
	let viewportWidth = $state(0);
	let measuredItemHeight = $state(1);
	let range = $state<VirtualWindowRange>(createFullWindowRange(0));
	let frameId: number | null = null;

	const resolvedItemHeight = $derived(
		resolveResponsiveItemHeight({
			itemHeight,
			itemHeightMobile,
			mobileBreakpoint,
			viewportWidth
		})
	);

	const visibleEntries = $derived.by(() =>
		items
			.slice(range.startIndex, range.endIndex)
			.map((item, offset) => ({ item, index: range.startIndex + offset }))
	);

	function scheduleUpdate() {
		if (typeof window === 'undefined') {
			return;
		}
		if (frameId !== null) {
			return;
		}
		frameId = window.requestAnimationFrame(() => {
			frameId = null;
			updateRange();
		});
	}

	function updateRange() {
		if (typeof window === 'undefined' || !localContainer) {
			range = createFullWindowRange(items.length);
			return;
		}

		const estimatedItemHeight = Math.max(1, measuredItemHeight || resolvedItemHeight || 1);
		let viewportHeight = 0;
		let scrollOffset = 0;

		if (useContainerScroll) {
			viewportHeight = localContainer.clientHeight;
			scrollOffset = localContainer.scrollTop;
		} else {
			const rect = localContainer.getBoundingClientRect();
			viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
			scrollOffset = Math.max(0, -rect.top);
		}

		range = computeVirtualWindowRange({
			totalItems: items.length,
			itemHeight: estimatedItemHeight,
			viewportHeight,
			scrollOffset,
			overscan,
			threshold
		});
	}

	function measureRenderedItemHeight() {
		if (!localContainer) {
			return;
		}
		const elements = Array.from(localContainer.children).filter(
			(element): element is HTMLElement =>
				element instanceof HTMLElement && element.hasAttribute('data-window-item')
		);
		if (elements.length === 0) {
			return;
		}
		const averageHeight =
			elements.reduce((sum, element) => sum + element.offsetHeight, 0) / elements.length;
		if (!Number.isFinite(averageHeight) || averageHeight <= 0) {
			return;
		}
		if (Math.abs(averageHeight - measuredItemHeight) < 2) {
			return;
		}
		measuredItemHeight = Math.max(1, averageHeight);
		updateRange();
	}

	$effect(() => {
		containerElement = localContainer;
	});

	$effect(() => {
		measuredItemHeight = Math.max(1, resolvedItemHeight);
		scheduleUpdate();
	});

	$effect(() => {
		items.length;
		itemHeightMobile;
		mobileBreakpoint;
		overscan;
		threshold;
		scheduleUpdate();
	});

	$effect(() => {
		range.startIndex;
		range.endIndex;
		items.length;
		void tick().then(measureRenderedItemHeight);
	});

	onMount(() => {
		if (typeof window === 'undefined') {
			return;
		}

		const syncViewportWidth = () => {
			viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
		};

		const handleScroll = () => scheduleUpdate();
		const handleResize = () => {
			syncViewportWidth();
			scheduleUpdate();
		};

		syncViewportWidth();

		if (useContainerScroll) {
			localContainer?.addEventListener('scroll', handleScroll, { passive: true });
		} else {
			window.addEventListener('scroll', handleScroll, { passive: true });
		}
		window.addEventListener('resize', handleResize, { passive: true });

		const resizeObserver =
			typeof ResizeObserver === 'undefined'
				? null
				: new ResizeObserver(() => {
						scheduleUpdate();
					});
		if (resizeObserver && localContainer) {
			resizeObserver.observe(localContainer);
		}

		scheduleUpdate();

		return () => {
			if (useContainerScroll) {
				localContainer?.removeEventListener('scroll', handleScroll);
			} else {
				window.removeEventListener('scroll', handleScroll);
			}
			window.removeEventListener('resize', handleResize);
			resizeObserver?.disconnect();
			if (frameId !== null) {
				window.cancelAnimationFrame(frameId);
				frameId = null;
			}
		};
	});
</script>

<div
	{id}
	bind:this={localContainer}
	class={className}
	data-tone={dataTone ?? undefined}
	data-windowed={range.windowed ? 'true' : undefined}
	style={`padding-top:${range.paddingStart}px;padding-bottom:${range.paddingEnd}px;`}
>
	{#each visibleEntries as entry (entry.index)}
		{@render row(entry.item, entry.index)}
	{/each}
</div>
