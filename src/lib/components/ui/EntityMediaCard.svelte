<script lang="ts">
	import { Disc, User } from 'lucide-svelte';

	export type EntityCardLink = {
		href: string;
		label: string;
		preload?: boolean;
	};

	interface Props {
		type: 'album' | 'artist';
		href: string;
		title: string;
		subtitle?: string | null;
		meta?: string | null;
		description?: string | null;
		imageSrc?: string | null;
		imageAlt?: string;
		links?: EntityCardLink[];
		preload?: boolean;
	}

	let {
		type,
		href,
		title,
		subtitle = null,
		meta = null,
		description = null,
		imageSrc = null,
		imageAlt = '',
		links = [],
		preload = true
	}: Props = $props();
</script>

<article class="ui-media-card ui-entity-card">
	<a
		href={href}
		class="ui-media-card__primary-link"
		data-sveltekit-preload-data={preload ? '' : undefined}
	>
		<div class="ui-media-card__artwork" class:ui-media-card__artwork--circle={type === 'artist'}>
			{#if imageSrc}
				<img src={imageSrc} alt={imageAlt || title} loading="lazy" decoding="async" />
			{:else}
				<div class="ui-entity-card__placeholder">
					{#if type === 'artist'}
						<User size={36} />
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
		</div>
	</a>
	{#if links.length > 0}
		<div class="ui-media-card__links" class:ui-media-card__links--paired={links.length === 2}>
			{#each links as link (`${link.href}:${link.label}`)}
				<a
					href={link.href}
					class="ui-media-card__link"
					data-sveltekit-preload-data={link.preload === false ? undefined : ''}
				>
					{link.label}
				</a>
			{/each}
		</div>
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
