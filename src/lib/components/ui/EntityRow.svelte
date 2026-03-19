<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { EntityRowVM } from '$lib/presentation/viewModels';

	type Props = {
		item: EntityRowVM;
		className?: string;
		windowItem?: boolean;
		onPrimaryAction?: (() => void) | null;
		action?: Snippet<[EntityRowVM]>;
	};

	let {
		item,
		className = '',
		windowItem = false,
		onPrimaryAction = null,
		action
	}: Props = $props();

	const itemTone = $derived(item.tone ?? 'default');
	const hasAction = $derived(Boolean(action));
</script>

<div
	class={`ui-list-row ${hasAction ? 'ui-list-row--actionable' : 'ui-list-row--single'} ui-perf-row ${className}`.trim()}
	data-tone={itemTone === 'default' ? undefined : itemTone}
	data-window-item={windowItem ? '' : undefined}
>
	{#snippet content()}
		{#if item.artwork}
			<div
				class={`ui-list-row__media ${item.artwork.shape === 'circle' ? 'ui-list-row__media--circle' : ''}`.trim()}
				aria-hidden="true"
			>
				{#if item.artwork.src}
					<img src={item.artwork.src} alt="" loading="lazy" decoding="async" />
				{:else}
					<span class="ui-list-row__media-fallback">{item.artwork.fallbackLabel ?? '•'}</span>
				{/if}
			</div>
		{/if}
		<div class="ui-list-row__text">
			<p class="ui-list-row__title">
				<span class="ui-list-row__title-text">{item.title}</span>
				{#if item.titleSuffix}
					<span class="ui-list-row__muted">({item.titleSuffix})</span>
				{/if}
				{#if item.badge?.kind === 'image'}
					<span
						class="ui-list-row__musicbrainz-indicator"
						aria-label={item.badge.label}
						title={item.badge.title ?? item.badge.label}
					>
						<img src={item.badge.src} alt="" aria-hidden="true" />
					</span>
				{:else if item.badge?.kind === 'text'}
					<span
						class="ui-inline-tag"
						aria-label={item.badge.label}
						title={item.badge.title ?? item.badge.label}
					>
						{item.badge.text}
					</span>
				{/if}
			</p>
			{#if item.subtitle}
				<p class="ui-list-row__meta">{item.subtitle}</p>
			{/if}
			{#if item.meta}
				<p class={`ui-list-row__meta ${item.meta.includes('•') ? 'ui-list-row__meta--wrap' : ''}`.trim()}>
					{item.meta}
				</p>
			{/if}
			{#if item.description}
				<p class="ui-list-row__value">{item.description}</p>
			{/if}
			{#if item.status}
				<p class="ui-list-row__value">{item.status}</p>
			{/if}
		</div>
	{/snippet}
	{#if item.primaryAction === 'button'}
		<button
			type="button"
			class="ui-list-row__main ui-list-row__main--button"
			onclick={onPrimaryAction ?? undefined}
			aria-label={item.primaryAriaLabel ?? undefined}
		>
			{@render content()}
		</button>
	{:else if item.primaryAction === 'link' && item.href}
		<a
			href={item.href}
			class="ui-list-row__main"
			aria-label={item.primaryAriaLabel ?? undefined}
			data-sveltekit-preload-data={item.preload !== false ? '' : undefined}
		>
			{@render content()}
		</a>
	{:else}
		<div class="ui-list-row__main">
			{@render content()}
		</div>
	{/if}
	{#if action}
		{@render action(item)}
	{/if}
</div>
