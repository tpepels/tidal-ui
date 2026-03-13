<script lang="ts">
	import type { HTMLAttributes } from 'svelte/elements';
	import type { Snippet } from 'svelte';
	import { Disc, ListMusic, User } from 'lucide-svelte';
	import CoverArt from '$lib/components/CoverArt.svelte';

	type Tone = 'default' | 'secondary' | 'tertiary';

	export type EntityCardLink = {
		href: string;
		label: string;
		preload?: boolean;
	};

	interface Props extends HTMLAttributes<HTMLElement> {
		type: 'album' | 'artist' | 'playlist';
		href: string;
		title: string;
		subtitle?: string | null;
		meta?: string | null;
		description?: string | null;
		intent?: string | null;
		imageSrc?: string | null;
		imageAlt?: string;
		coverCacheKey?: string | null;
		coverCandidates?: string[];
		links?: EntityCardLink[];
		preload?: boolean;
		tone?: Tone;
		badge?: Snippet;
		action?: Snippet;
		artwork?: Snippet;
		bodyExtra?: Snippet;
		linksContent?: Snippet;
		footer?: Snippet;
	}

	let {
		type,
		href,
		title,
		subtitle = null,
		meta = null,
		description = null,
		intent = null,
		imageSrc = null,
		imageAlt = '',
		coverCacheKey = null,
		coverCandidates = [],
		links = [],
		preload = true,
		tone = 'default',
		badge,
		action,
		artwork,
		bodyExtra,
		linksContent,
		footer,
		class: className = '',
		...restProps
	}: Props = $props();

	function normalizeLinkLabel(value: string): string {
		const key = value.trim().toLowerCase();
		if (key === 'album page') return 'Open Album';
		if (key === 'artist page') return 'Open Artist';
		if (key === 'playlist page') return 'Open Playlist';
		if (key === 'search album' || key === 'search artist') return 'Search';
		return value;
	}

	function resolveCardTone(): Exclude<Tone, 'default'> | undefined {
		if (tone !== 'default') {
			return tone;
		}
		if (type === 'album') {
			return 'secondary';
		}
		if (type === 'artist') {
			return 'tertiary';
		}
		return undefined;
	}
</script>

<article
	{...restProps}
	class={`ui-media-card ui-entity-card ui-perf-card ${className}`.trim()}
	data-tone={resolveCardTone()}
>
	{#if badge}
		{@render badge()}
	{/if}
	{#if action}
		{@render action()}
	{/if}
	<a
		href={href}
		class="ui-media-card__primary-link"
		data-sveltekit-preload-data={preload ? '' : undefined}
	>
		<div class="ui-media-card__artwork" class:ui-media-card__artwork--circle={type === 'artist'}>
			{#if artwork}
				{@render artwork()}
			{:else if type === 'album' && coverCacheKey && coverCandidates.length > 0}
				<CoverArt
					cacheKey={coverCacheKey}
					candidates={coverCandidates}
					alt={imageAlt || title}
					class="h-full w-full object-cover"
				/>
			{:else if imageSrc}
				<img src={imageSrc} alt={imageAlt || title} loading="lazy" decoding="async" />
			{:else}
				<div class="ui-entity-card__placeholder">
					{#if type === 'artist'}
						<User size={36} />
					{:else if type === 'playlist'}
						<ListMusic size={30} />
					{:else}
						<Disc size={30} />
					{/if}
				</div>
			{/if}
		</div>
		<div class="ui-media-card__body">
			<h3 class="ui-media-card__title ui-media-card__title--truncate">{title}</h3>
			{#if subtitle}
				<p class="ui-media-card__subtitle ui-media-card__title--truncate">{subtitle}</p>
			{/if}
			{#if meta}
				<p class="ui-media-card__meta">{meta}</p>
			{/if}
			{#if description}
				<p class="ui-media-card__meta ui-entity-card__description">{description}</p>
			{/if}
			{#if intent}
				<p class="ui-media-card__intent">{intent}</p>
			{/if}
			{#if bodyExtra}
				{@render bodyExtra()}
			{/if}
		</div>
	</a>
	{#if linksContent}
		{@render linksContent()}
	{:else if links.length > 0}
		<div class="ui-media-card__links" class:ui-media-card__links--paired={links.length === 2}>
			{#each links as link (`${link.href}:${link.label}`)}
				<a
					href={link.href}
					class="ui-media-card__link"
					data-sveltekit-preload-data={link.preload === false ? undefined : ''}
				>
					{normalizeLinkLabel(link.label)}
				</a>
			{/each}
		</div>
	{/if}
	{#if footer}
		{@render footer()}
	{/if}
</article>

<style>
	.ui-entity-card {
		height: 100%;
	}

	.ui-entity-card__placeholder {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		color: rgba(163, 163, 163, 0.8);
		background: var(--ui-surface-1, rgba(255, 255, 255, 0.055));
	}

	.ui-entity-card__description {
		display: -webkit-box;
		line-clamp: 2;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
</style>
