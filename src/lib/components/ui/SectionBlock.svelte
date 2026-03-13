<script lang="ts">
	type Tone = 'default' | 'secondary' | 'tertiary';

	export let id: string | undefined = undefined;
	export let eyebrow: string | null = null;
	export let title: string | null = null;
	export let subtitle: string | null = null;
	export let status: string | null = null;
	export let count: string | number | null = null;
	export let tone: Tone = 'default';
	export let className = '';
	export let contentClassName = '';
	export let headerBorder = true;

	let hasStructuredHeader = false;
	$: hasStructuredHeader =
		typeof eyebrow === 'string' ||
		typeof title === 'string' ||
		typeof subtitle === 'string' ||
		typeof status === 'string' ||
		count !== null;
</script>

<section
	id={id}
	class={`ui-section-block ${className}`.trim()}
	data-tone={tone === 'default' ? undefined : tone}
>
	{#if hasStructuredHeader || $$slots.header}
		<header
			class={`ui-section-block__header ${headerBorder ? '' : 'ui-section-block__header--borderless'}`.trim()}
		>
			<div class="ui-section-block__title-group">
				{#if eyebrow}
					<p class="ui-section-block__eyebrow">{eyebrow}</p>
				{/if}
				{#if title}
					<h2 class="ui-section-block__title">{title}</h2>
				{/if}
				{#if subtitle}
					<p class="ui-section-block__subtitle">{subtitle}</p>
				{/if}
				{#if status}
					<p class="ui-section-block__status" aria-live="polite">{status}</p>
				{/if}
				{#if $$slots.header}
					<slot name="header" />
				{/if}
			</div>
			{#if count !== null}
				<span class="ui-section-block__count">{count}</span>
			{:else if $$slots.actions}
				<div class="ui-section-block__actions">
					<slot name="actions" />
				</div>
			{/if}
		</header>
	{/if}
	<div class={`ui-section-block__content ${contentClassName}`.trim()}>
		<slot />
	</div>
</section>
