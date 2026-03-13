<script lang="ts">
	import {
		buildSectionHashUrl,
		normalizeSectionId,
		resolveHashSectionId,
		shouldSkipInitialSectionHashSync
	} from '$lib/components/ui/pageSectionNavState';

	type Tone = 'default' | 'secondary' | 'tertiary';

	export type PageSectionNavItem = {
		id: string;
		label: string;
		tone?: Tone;
		hidden?: boolean;
	};

	let {
		items = [],
		sticky = false,
		ariaLabel = 'Page sections',
		className = ''
	}: {
		items?: PageSectionNavItem[];
		sticky?: boolean;
		ariaLabel?: string;
		className?: string;
	} = $props();

	let activeId = $state('');
	let lastObservedId = $state('');

	const visibleItems = $derived.by(() =>
		items.filter((item) => !item.hidden && item.id.trim().length > 0)
	);

	function scheduleSectionRestore(callback: () => void): void {
		if (typeof window === 'undefined') {
			return;
		}
		if (typeof window.requestAnimationFrame === 'function') {
			window.requestAnimationFrame(() => {
				window.requestAnimationFrame(callback);
			});
			return;
		}
		window.setTimeout(callback, 0);
	}

	$effect(() => {
		if (visibleItems.length === 0) {
			activeId = '';
			lastObservedId = '';
			return;
		}

		if (!activeId || !visibleItems.some((item) => item.id === activeId)) {
			activeId = visibleItems[0]?.id ?? '';
		}
	});

	$effect(() => {
		if (typeof window === 'undefined' || typeof document === 'undefined' || visibleItems.length === 0) {
			return;
		}

		const nodes = visibleItems
			.map((item) => document.getElementById(item.id))
			.filter((node): node is HTMLElement => node instanceof HTMLElement);

		if (nodes.length === 0) {
			return;
		}

		const firstVisibleId = visibleItems[0]?.id ?? '';
		const knownIds = new Set(nodes.map((node) => node.id));

		const replaceCurrentEntryHash = (sectionId: string) => {
			const normalizedId = normalizeSectionId(sectionId);
			if (!normalizedId) {
				return;
			}
			const currentHash = normalizeSectionId(window.location.hash);
			if (currentHash === normalizedId) {
				return;
			}
			window.history.replaceState(
				window.history.state,
				'',
				buildSectionHashUrl(window.location, normalizedId)
			);
		};

		const restoreHashTarget = (sectionId: string) => {
			const normalizedId = normalizeSectionId(sectionId);
			if (!normalizedId || !knownIds.has(normalizedId)) {
				return;
			}
			const target = document.getElementById(normalizedId);
			if (!(target instanceof HTMLElement)) {
				return;
			}
			scheduleSectionRestore(() => {
				target.scrollIntoView({ block: 'start', behavior: 'auto' });
			});
		};

		const syncFromHash = (restoreScroll: boolean) => {
			const hash = resolveHashSectionId(window.location.hash, knownIds);
			if (!hash) {
				return;
			}
			activeId = hash;
			lastObservedId = hash;
			if (restoreScroll) {
				restoreHashTarget(hash);
			}
		};

		const handleHashChange = () => {
			syncFromHash(true);
		};

		syncFromHash(true);

		if (typeof IntersectionObserver === 'undefined') {
			window.addEventListener('hashchange', handleHashChange);
			window.addEventListener('popstate', handleHashChange);
			return () => {
				window.removeEventListener('hashchange', handleHashChange);
				window.removeEventListener('popstate', handleHashChange);
			};
		}

		const observer = new IntersectionObserver(
			(entries) => {
				const visibleEntries = entries
					.filter((entry) => entry.isIntersecting)
					.sort((left, right) => Math.abs(left.boundingClientRect.top) - Math.abs(right.boundingClientRect.top));
				const next = visibleEntries[0]?.target;
				if (next instanceof HTMLElement && next.id) {
					const nextId = normalizeSectionId(next.id);
					if (!nextId || !knownIds.has(nextId) || activeId === nextId) {
						return;
					}
					activeId = nextId;
					const shouldSkipInitialHashSync = shouldSkipInitialSectionHashSync({
						lastObservedId,
						currentHash: window.location.hash,
						nextId,
						firstVisibleId
					});
					lastObservedId = nextId;
					if (!shouldSkipInitialHashSync) {
						replaceCurrentEntryHash(nextId);
					}
				}
			},
			{
				rootMargin: '-16% 0px -60% 0px',
				threshold: [0.1, 0.35, 0.7]
			}
		);

		for (const node of nodes) {
			observer.observe(node);
		}

		window.addEventListener('hashchange', handleHashChange);
		window.addEventListener('popstate', handleHashChange);

		return () => {
			observer.disconnect();
			window.removeEventListener('hashchange', handleHashChange);
			window.removeEventListener('popstate', handleHashChange);
		};
	});
</script>

{#if visibleItems.length > 1}
	<nav
		class={`ui-section-nav ${sticky ? 'ui-section-nav--sticky' : ''} ${className}`.trim()}
		aria-label={ariaLabel}
	>
		<div class="ui-section-nav__inner">
			{#each visibleItems as item (item.id)}
				<a
					href={`#${item.id}`}
					class="ui-section-nav__link"
					class:is-active={activeId === item.id}
					data-tone={item.tone && item.tone !== 'default' ? item.tone : undefined}
					aria-current={activeId === item.id ? 'location' : undefined}
					onclick={() => {
						activeId = item.id;
						lastObservedId = item.id;
					}}
				>
					{item.label}
				</a>
			{/each}
		</div>
	</nav>
{/if}

<style>
	.ui-section-nav {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.ui-section-nav--sticky {
		z-index: 8;
	}

	.ui-section-nav__inner {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
		padding: 0.55rem 0;
		border-top: 1px solid var(--ui-divider, rgba(255, 255, 255, 0.08));
		border-bottom: 1px solid var(--ui-divider, rgba(255, 255, 255, 0.08));
	}

	.ui-section-nav__link {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 40px;
		padding: 0.44rem 0.72rem;
		border-radius: 999px;
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.08));
		background: rgba(255, 255, 255, 0.02);
		font-size: 0.84rem;
		font-weight: 600;
		line-height: 1.25;
		color: rgba(220, 220, 220, 0.84);
		text-decoration: none;
		transition:
			border-color var(--ui-motion-fast) var(--ui-ease-standard),
			background var(--ui-motion-fast) var(--ui-ease-standard),
			color var(--ui-motion-fast) var(--ui-ease-standard);
	}

	.ui-section-nav__link:hover {
		border-color: var(--ui-border-strong, rgba(255, 255, 255, 0.16));
		background: rgba(255, 255, 255, 0.045);
		color: rgba(245, 245, 245, 0.96);
	}

	.ui-section-nav__link.is-active {
		border-color: rgba(255, 255, 255, 0.18);
		background: rgba(255, 255, 255, 0.08);
		color: rgba(255, 255, 255, 0.98);
	}

	.ui-section-nav__link[data-tone='secondary'].is-active {
		border-color: var(--ui-tone-secondary-border-strong, rgba(183, 202, 255, 0.62));
		background: var(--ui-tone-secondary-surface-hover, rgba(104, 136, 210, 0.24));
		color: var(--ui-tone-secondary-text, rgba(224, 234, 255, 0.96));
	}

	.ui-section-nav__link[data-tone='tertiary'].is-active {
		border-color: var(--ui-tone-tertiary-border-strong, rgba(183, 229, 208, 0.62));
		background: var(--ui-tone-tertiary-surface-hover, rgba(96, 156, 130, 0.24));
		color: var(--ui-tone-tertiary-text, rgba(220, 244, 233, 0.96));
	}

	@media (min-width: 960px) {
		.ui-section-nav--sticky {
			position: sticky;
			top: 0.72rem;
			background: rgba(7, 7, 7, 0.94);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.ui-section-nav__link {
			transition: none;
			transform: none;
		}
	}
</style>
