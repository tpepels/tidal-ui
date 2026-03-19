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
			<button class="toast-close" aria-label="Dismiss notification" on:click={() => toasts.remove(toast.id)}>
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
		transition:
			border-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			background var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			transform var(--ui-motion-fast, 140ms) var(--ui-ease-emphasis, cubic-bezier(0.16, 1, 0.3, 1));
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
		border-radius: var(--ui-radius-sm, 9px);
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		background: var(--ui-surface-0, rgba(255, 255, 255, 0.035));
		color: inherit;
		font-size: 12px;
		font-weight: 600;
		transition:
			border-color var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			background var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			transform var(--ui-motion-fast, 140ms) var(--ui-ease-emphasis, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.toast-action:hover {
		border-color: var(--ui-border-strong, rgba(255, 255, 255, 0.34));
		background: var(--ui-surface-1, rgba(255, 255, 255, 0.055));
		transform: translateY(var(--ui-lift-y, -1px));
	}

	.toast-action:active {
		transform: translateY(var(--ui-press-y, 0px));
	}

	.toast-close {
		all: unset;
		cursor: pointer;
		flex-shrink: 0;
		padding: 2px;
		border-radius: 4px;
		transition:
			background var(--ui-motion-fast, 140ms) var(--ui-ease-standard, cubic-bezier(0.2, 0, 0, 1)),
			transform var(--ui-motion-fast, 140ms) var(--ui-ease-emphasis, cubic-bezier(0.16, 1, 0.3, 1));
	}

	.toast-close:hover {
		background: rgba(255, 255, 255, 0.16);
		transform: translateY(var(--ui-lift-y, -1px));
	}

	.toast-close:active {
		transform: translateY(var(--ui-press-y, 0px));
	}

	@media (prefers-reduced-motion: reduce) {
		.toast,
		.toast-action,
		.toast-close {
			transition: none;
		}

		.toast-action:hover,
		.toast-close:hover {
			transform: none;
		}
	}
</style>
