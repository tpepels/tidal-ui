<script lang="ts">
	let {
		kind = 'empty',
		title,
		message,
		actionLabel = null,
		onAction = null,
		embedded = false
	}: {
		kind?: 'loading' | 'empty' | 'error';
		title: string;
		message: string;
		actionLabel?: string | null;
		onAction?: (() => void) | null;
		embedded?: boolean;
	} = $props();
</script>

<div
	class="page-state"
	class:page-state--embedded={embedded}
	data-kind={kind}
	role={kind === 'error' ? 'alert' : 'status'}
>
	<h3>{title}</h3>
	<p>{message}</p>
	{#if onAction && actionLabel}
		<button type="button" class="ui-chip-button page-state__action" onclick={onAction}>{actionLabel}</button>
	{/if}
</div>

<style>
	.page-state {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.62rem;
		padding: 0.92rem;
		border-radius: var(--ui-radius-sm, 9px);
		border: 1px solid rgba(255, 255, 255, 0.14);
		background: rgba(255, 255, 255, 0.03);
	}

	.page-state[data-kind='error'] {
		border-color: rgba(239, 68, 68, 0.35);
		background: rgba(239, 68, 68, 0.12);
	}

	.page-state--embedded {
		padding: 0.72rem 0;
		border-radius: 0;
		border: 0;
		background: transparent;
		border-top: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
	}

	.page-state h3 {
		margin: 0;
		font-size: 1rem;
	}

	.page-state p {
		margin: 0;
		font-size: 0.9rem;
		opacity: 0.84;
		line-height: 1.35;
	}

	.page-state__action {
		min-height: 40px;
		padding-inline: 0.78rem;
		font-size: 0.86rem;
	}

	@media (prefers-reduced-motion: reduce) {
		.page-state__action {
			animation: none !important;
			transition: none !important;
			transform: none !important;
		}
	}
</style>
