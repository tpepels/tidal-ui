<script lang="ts">
	import { Calendar, Clock, Disc, User } from 'lucide-svelte';
	import EntityRow from '$lib/components/ui/EntityRow.svelte';
	import MetaStrip from '$lib/components/ui/MetaStrip.svelte';
	import type { DetailHeroVM, DetailMetaItemVM } from '$lib/presentation/viewModels';

	type Props = {
		hero: DetailHeroVM;
	};

	let { hero }: Props = $props();

	function resolveMetaIcon(item: Extract<DetailMetaItemVM, { kind: 'icon' }>) {
		switch (item.icon) {
			case 'calendar':
				return Calendar;
			case 'disc':
				return Disc;
			case 'user':
				return User;
			default:
				return Clock;
		}
	}

	function resolveVisualShape(): 'square' | 'circle' {
		if (!hero.visual) {
			return 'square';
		}
		if (hero.visual.kind === 'artwork') {
			return hero.visual.artwork.shape ?? 'square';
		}
		return hero.visual.shape ?? 'square';
	}

	function resolveFallbackLabel(): string {
		if (!hero.visual) {
			return '•';
		}
		if (hero.visual.kind === 'artwork') {
			return hero.visual.artwork.fallbackLabel ?? '•';
		}
		return hero.visual.fallbackLabel ?? '•';
	}
</script>

<section class="ui-detail-hero" data-ui-block="entity-hero">
	<div class="ui-detail-hero__layout">
		{#if hero.visual}
			{@const isCircle = resolveVisualShape() === 'circle'}
			<div class={`ui-detail-hero__art ${isCircle ? 'ui-detail-hero__art--circle' : ''}`.trim()}>
				{#if hero.visual.kind === 'video'}
					<video
						src={hero.visual.src}
						poster={hero.visual.posterSrc ?? undefined}
						aria-label={hero.visual.alt}
						autoplay
						loop
						muted
						playsinline
						preload="metadata"
					></video>
				{:else if hero.visual.artwork.src}
					<img
						src={hero.visual.artwork.src}
						alt={hero.visual.artwork.alt ?? hero.title}
						loading="eager"
						decoding="async"
					/>
				{:else}
					<div class="flex h-full w-full items-center justify-center bg-white/3 text-gray-500">
						<span class="ui-list-row__media-fallback">{resolveFallbackLabel()}</span>
					</div>
				{/if}
			</div>
		{/if}

		<div class="ui-detail-hero__body">
			<p class="ui-detail-hero__eyebrow">{hero.eyebrow}</p>
			<h1 class="ui-detail-hero__title">{hero.title}</h1>

			{#if hero.description}
				<p class="ui-detail-hero__description">{hero.description}</p>
			{/if}

			{#if hero.supportLinks && hero.supportLinks.length > 0}
				<div class="ui-detail-hero__support">
					{#each hero.supportLinks as link, index (link.id)}
						<a
							href={link.href}
							data-sveltekit-preload-data={link.preload !== false && !link.external ? '' : undefined}
							target={link.external ? '_blank' : undefined}
							rel={link.external ? 'noopener noreferrer' : undefined}
							aria-label={link.ariaLabel ?? undefined}
						>
							{link.label}
						</a>
						{#if index < hero.supportLinks.length - 1}
							<span aria-hidden="true">•</span>
						{/if}
					{/each}
				</div>
			{/if}

			{#if hero.metaItems && hero.metaItems.length > 0}
				<MetaStrip>
					{#each hero.metaItems as item, index (`${item.kind}:${index}`)}
						{#if item.kind === 'tag'}
							<span class="ui-inline-tag">{item.label}</span>
						{:else if item.kind === 'text'}
							<div class="ui-meta-strip__item">{item.label}</div>
						{:else}
							<div class="ui-meta-strip__item">
								{#if item.imageSrc}
									<img
										src={item.imageSrc}
										alt={item.imageAlt ?? ''}
										class={item.imageShape === 'circle' ? 'h-8 w-8 rounded-full' : 'h-8 w-8 rounded-md'}
									/>
								{:else}
									{@const Icon = resolveMetaIcon(item)}
									<Icon size={16} />
								{/if}
								{item.label}
							</div>
						{/if}
					{/each}
				</MetaStrip>
			{/if}

			{#if hero.relatedItems && hero.relatedItems.length > 0}
				<div class="ui-list-surface ui-link-row-list ui-detail-hero__related">
					{#each hero.relatedItems as item (item.id)}
						<EntityRow item={item} />
					{/each}
				</div>
			{/if}
		</div>
	</div>
</section>
