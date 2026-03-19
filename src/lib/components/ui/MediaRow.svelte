<script lang="ts">
	import type { Snippet } from 'svelte';
	import CoverArt from '$lib/components/CoverArt.svelte';

	type Tone = 'default' | 'secondary' | 'tertiary';

	let {
		href = null,
		title,
		subtitle = null,
		meta = null,
		description = null,
		imageSrc = null,
		imageAlt = '',
		coverCacheKey = null,
		coverCandidates = [],
		circle = false,
		tone = 'default',
		preload = true,
		className = '',
		action,
		badge,
		artwork,
		bodyExtra,
		footer
	}: {
		href?: string | null;
		title: string;
		subtitle?: string | null;
		meta?: string | null;
		description?: string | null;
		imageSrc?: string | null;
		imageAlt?: string;
		coverCacheKey?: string | null;
		coverCandidates?: string[];
		circle?: boolean;
		tone?: Tone;
		preload?: boolean;
		className?: string;
		action?: Snippet;
		badge?: Snippet;
		artwork?: Snippet;
		bodyExtra?: Snippet;
		footer?: Snippet;
	} = $props();

	const isLink = $derived(typeof href === 'string' && href.trim().length > 0);
</script>

<article
	class={`ui-media-row ${action ? 'ui-media-row--actionable' : 'ui-media-row--single'} ${className}`.trim()}
	data-tone={tone === 'default' ? undefined : tone}
>
	<svelte:element
		this={isLink ? 'a' : 'div'}
		class="ui-media-row__main"
		href={isLink ? href : undefined}
		data-sveltekit-preload-data={isLink && preload ? '' : undefined}
	>
		<div class={`ui-media-row__artwork ${circle ? 'ui-media-row__artwork--circle' : ''}`.trim()}>
			{#if artwork}
				{@render artwork()}
			{:else if coverCacheKey && coverCandidates.length > 0}
				<CoverArt
					cacheKey={coverCacheKey}
					candidates={coverCandidates}
					alt={imageAlt || title}
					class="h-full w-full object-cover"
				/>
			{:else if imageSrc}
				<img src={imageSrc} alt={imageAlt || title} loading="lazy" decoding="async" />
			{:else}
				<span class="ui-media-row__artwork-fallback">
					{(title.slice(0, 1) || '•').toUpperCase()}
				</span>
			{/if}
		</div>
		<div class="ui-media-row__body">
			<p class="ui-media-row__title">
				<span class="ui-media-row__title-text">{title}</span>
				{#if badge}
					{@render badge()}
				{/if}
			</p>
			{#if subtitle}
				<p class="ui-media-row__subtitle">{subtitle}</p>
			{/if}
			{#if meta}
				<p class="ui-media-row__meta">{meta}</p>
			{/if}
			{#if description}
				<p class="ui-media-row__description">{description}</p>
			{/if}
			{#if bodyExtra}
				<div class="ui-media-row__extra">
					{@render bodyExtra()}
				</div>
			{/if}
			{#if footer}
				<div class="ui-media-row__footer">
					{@render footer()}
				</div>
			{/if}
		</div>
	</svelte:element>

	{#if action}
		<div class="ui-media-row__side">
			{@render action()}
		</div>
	{/if}
</article>
