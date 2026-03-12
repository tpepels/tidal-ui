<script lang="ts">
	export let className = '';
	export let gridRole = '';
</script>

<div
	class={`ui-data-grid ${className}`.trim()}
	data-ui-role="data-grid"
	data-ui-grid-role={gridRole || undefined}
>
	<slot />
</div>
