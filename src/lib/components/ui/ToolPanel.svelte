<script lang="ts">
	export let eyebrow: string | null = null;
	export let title: string | null = null;
	export let subtitle: string | null = null;
	export let wide = false;
	export let flush = false;
	export let className = '';
	export let panelRole = '';
	let hasStructuredHeader = false;

	$: hasStructuredHeader =
		typeof eyebrow === 'string' || typeof title === 'string' || typeof subtitle === 'string';
</script>

<section
	class={`ui-tool-panel ${wide ? 'ui-tool-panel--wide' : ''} ${flush ? 'ui-tool-panel--flush' : ''} ${className}`.trim()}
	data-ui-role="tool-panel"
	data-ui-panel-role={panelRole || undefined}
>
	{#if hasStructuredHeader}
		<header class="ui-tool-panel__header">
			{#if eyebrow}
				<p class="ui-tool-panel__eyebrow">{eyebrow}</p>
			{/if}
			{#if title}
				<h2 class="ui-tool-panel__title">{title}</h2>
			{/if}
			{#if subtitle}
				<p class="ui-tool-panel__subtitle">{subtitle}</p>
			{/if}
		</header>
	{:else if $$slots.header}
		<header class="ui-tool-panel__header">
			<slot name="header" />
		</header>
	{/if}
	<slot />
</section>
