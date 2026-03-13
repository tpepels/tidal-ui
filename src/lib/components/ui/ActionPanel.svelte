<script lang="ts">
	type Tone = 'default' | 'secondary' | 'tertiary';

	export let intent: string | null = null;
	export let summary: string | null = null;
	export let tone: Tone = 'default';
	export let intentful = false;
	export let className = '';
	export let panelRole = '';

	let hasStructuredHeader = false;
	$: hasStructuredHeader = typeof intent === 'string' || typeof summary === 'string';
</script>

<div
	class={`ui-action-panel ${intentful ? 'ui-action-panel--intentful' : ''} ${className}`.trim()}
	data-ui-role="action-panel"
	data-ui-panel-role={panelRole || undefined}
	data-tone={tone === 'default' ? undefined : tone}
>
	{#if hasStructuredHeader}
		<div class="ui-action-panel__header">
			{#if intent}
				<p class="ui-action-panel__intent">{intent}</p>
			{/if}
			{#if summary}
				<p class="ui-action-panel__summary">{summary}</p>
			{/if}
		</div>
	{:else if $$slots.header}
		<div class="ui-action-panel__header">
			<slot name="header" />
		</div>
	{/if}
	<slot />
</div>
