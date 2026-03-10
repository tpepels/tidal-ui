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
		border-radius: 12px;
		border: 1px solid rgba(212, 212, 212, 0.24);
		background: linear-gradient(160deg, rgba(15, 15, 15, 0.6), rgba(8, 8, 8, 0.44));
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
		font-size: 0.78rem;
		opacity: 0.84;
		line-height: 1.35;
	}

	.page-state__action {
		border-radius: 10px;
		border: 1px solid rgba(212, 212, 212, 0.38);
		background: rgba(255, 255, 255, 0.08);
		padding: 0.42rem 0.62rem;
		font-size: 0.72rem;
		font-weight: 600;
		color: inherit;
	}
</style>
