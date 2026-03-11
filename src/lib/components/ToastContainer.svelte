<script lang="ts">
	import { toasts } from '$lib/stores/toasts';
	import { X, CheckCircle2, AlertCircle, AlertTriangle, Info } from 'lucide-svelte';

	function getIcon(type: string) {
		switch (type) {
			case 'success': return CheckCircle2;
			case 'error': return AlertCircle;
			case 'warning': return AlertTriangle;
			case 'info': return Info;
			default: return Info;
		}
	}
</script>

<div class="toast-container">
	{#each $toasts as toast (toast.id)}
		<div class="toast toast--{toast.type}">
			<div class="toast-icon">
				<svelte:component this={getIcon(toast.type)} size={20} />
			</div>
			<div class="toast-content">
				<p class="toast-message">{toast.message}</p>
				{#if toast.action}
					<button class="toast-action" on:click={toast.action.handler}>
						{toast.action.label}
					</button>
				{/if}
			</div>
			<button class="toast-close" on:click={() => toasts.remove(toast.id)}>
				<X size={16} />
			</button>
		</div>
	{/each}
</div>

<style>
	.toast-container {
		position: fixed;
		top: 20px;
		left: 20px;
		z-index: 10000;
		display: flex;
		flex-direction: column;
		gap: 10px;
		pointer-events: none;
	}

	@media (min-width: 768px) {
		.toast-container {
			display: grid;
			grid-template-columns: repeat(2, 1fr);
			gap: 10px;
			max-width: 600px;
		}
	}

	.toast {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		padding: 12px 16px;
		border-radius: var(--ui-radius-sm, 8px);
		border: 1px solid rgba(255, 255, 255, 0.22);
		box-shadow: none;
		min-width: 300px;
		max-width: 500px;
		pointer-events: auto;
		font-size: 14px;
		line-height: 1.4;
		background: #141414;
		color: rgba(245, 245, 245, 0.95);
	}

	.toast--success {
		border-color: rgba(255, 255, 255, 0.34);
		background: #181818;
	}

	.toast--error {
		border-color: rgba(255, 255, 255, 0.3);
		background: #121212;
	}

	.toast--warning {
		border-color: rgba(255, 255, 255, 0.28);
		background: #161616;
	}

	.toast--info {
		border-color: rgba(255, 255, 255, 0.26);
		background: #151515;
	}

	.toast-icon {
		flex-shrink: 0;
		margin-top: 2px;
	}

	.toast-content {
		flex: 1;
	}

	.toast-message {
		margin: 0;
		font-weight: 500;
	}

	.toast-action {
		all: unset;
		cursor: pointer;
		margin-top: 8px;
		padding: 4px 8px;
		border-radius: 0;
		background: rgba(255, 255, 255, 0.12);
		color: inherit;
		font-size: 12px;
		font-weight: 600;
		transition: background 0.2s;
	}

	.toast-action:hover {
		background: rgba(255, 255, 255, 0.22);
	}

	.toast-close {
		all: unset;
		cursor: pointer;
		flex-shrink: 0;
		padding: 2px;
		border-radius: 4px;
		transition: background 0.2s;
	}

	.toast-close:hover {
		background: rgba(255, 255, 255, 0.16);
	}
</style>
