<script lang="ts">
	let {
		kind = 'empty',
		title,
		message,
		actionLabel = null,
		onAction = null
	}: {
		kind?: 'loading' | 'empty' | 'error';
		title: string;
		message: string;
		actionLabel?: string | null;
		onAction?: (() => void) | null;
	} = $props();
</script>

<div class="page-state" data-kind={kind} role={kind === 'error' ? 'alert' : 'status'}>
	<h3>{title}</h3>
	<p>{message}</p>
	{#if onAction && actionLabel}
		<button type="button" class="page-state__action" onclick={onAction}>{actionLabel}</button>
	{/if}
</div>

<style>
	.page-state {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.5rem;
		padding: 0.8rem;
		border-radius: var(--ui-radius-sm, 9px);
		border: 1px solid rgba(255, 255, 255, 0.14);
		background: rgba(255, 255, 255, 0.03);
	}

	.page-state[data-kind='error'] {
		border-color: rgba(239, 68, 68, 0.35);
		background: rgba(239, 68, 68, 0.12);
	}

	.page-state h3 {
		margin: 0;
		font-size: 0.9rem;
	}

	.page-state p {
		margin: 0;
		font-size: 0.82rem;
		opacity: 0.84;
		line-height: 1.35;
	}

	.page-state__action {
		border-radius: var(--ui-radius-sm, 9px);
		border: 1px solid rgba(255, 255, 255, 0.2);
		background: rgba(255, 255, 255, 0.06);
		padding: 0.42rem 0.62rem;
		font-size: 0.76rem;
		font-weight: 600;
		color: inherit;
		transition:
			background var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			border-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			transform var(--ui-motion-fast, 140ms) var(--ui-ease-emphasis, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.page-state__action:hover {
		background: rgba(255, 255, 255, 0.12);
		border-color: rgba(255, 255, 255, 0.32);
		transform: translateY(var(--ui-lift-y, -1px));
	}

	@media (prefers-reduced-motion: reduce) {
		.page-state__action {
			animation: none !important;
			transition: none !important;
			transform: none !important;
		}
	}
</style>
