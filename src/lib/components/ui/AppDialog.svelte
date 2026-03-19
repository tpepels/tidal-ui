<script lang="ts">
	import { browser } from '$app/environment';
	import { tick } from 'svelte';
	import type { Snippet } from 'svelte';
	import type { DialogTone } from '$lib/presentation/viewModels';

	type DialogRole = 'dialog' | 'alertdialog';

	let {
		open = false,
		title,
		description = null,
		tone = 'default',
		dialogRole = 'dialog',
		initialFocusSelector = null,
		showCloseButton = false,
		closeLabel = 'Close dialog',
		closeOnEscape = true,
		onClose = null,
		actions,
		children
	}: {
		open?: boolean;
		title: string;
		description?: string | null;
		tone?: DialogTone;
		dialogRole?: DialogRole;
		initialFocusSelector?: string | null;
		showCloseButton?: boolean;
		closeLabel?: string;
		closeOnEscape?: boolean;
		onClose?: (() => void) | null;
		actions?: Snippet;
		children?: Snippet;
	} = $props();

	let panel = $state<HTMLElement | null>(null);
	let titleId = $state('');
	let descriptionId = $state('');
	let bodyId = $state('');
	let previouslyFocusedElement: HTMLElement | null = null;

	function createDialogId(prefix: string): string {
		return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
	}

	function getFocusableElements(): HTMLElement[] {
		if (!panel) {
			return [];
		}
		return Array.from(
			panel.querySelectorAll<HTMLElement>(
				'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		).filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
	}

	function trapFocus(event: KeyboardEvent): void {
		if (event.key !== 'Tab' || !panel) {
			return;
		}

		const focusable = getFocusableElements();
		if (focusable.length === 0) {
			event.preventDefault();
			panel.focus();
			return;
		}

		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const activeElement = document.activeElement;

		if (event.shiftKey && activeElement === first) {
			event.preventDefault();
			last.focus();
			return;
		}

		if (!event.shiftKey && activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (!open) {
			return;
		}
		if (event.key === 'Escape' && closeOnEscape) {
			event.preventDefault();
			onClose?.();
			return;
		}
		trapFocus(event);
	}

	$effect(() => {
		if (!open) {
			return;
		}

		titleId = createDialogId('dialog-title');
		descriptionId = createDialogId('dialog-description');
		bodyId = createDialogId('dialog-body');
	});

	$effect(() => {
		if (!browser || !open) {
			return;
		}

		const appShell = document.querySelector<HTMLElement>('[data-dialog-app-shell]');
		const previousOverflow = document.body.style.overflow;
		const previousAriaHidden = appShell?.getAttribute('aria-hidden') ?? null;
		const previousInert = appShell?.inert ?? false;

		previouslyFocusedElement =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;

		document.body.style.overflow = 'hidden';
		if (appShell) {
			appShell.inert = true;
			appShell.setAttribute('aria-hidden', 'true');
		}

		const focusInitialElement = async () => {
			await tick();
			if (!panel) {
				return;
			}

			const explicitTarget =
				initialFocusSelector && panel.querySelector<HTMLElement>(initialFocusSelector);
			const fallbackTarget = getFocusableElements()[0] ?? (panel as HTMLElement);
			const focusTarget = explicitTarget ?? fallbackTarget;
			if (focusTarget instanceof HTMLElement) {
				focusTarget.focus();
			}
		};

		void focusInitialElement();
		document.addEventListener('keydown', handleKeydown, true);

		return () => {
			document.removeEventListener('keydown', handleKeydown, true);
			document.body.style.overflow = previousOverflow;
			if (appShell) {
				appShell.inert = previousInert;
				if (previousAriaHidden === null) {
					appShell.removeAttribute('aria-hidden');
				} else {
					appShell.setAttribute('aria-hidden', previousAriaHidden);
				}
			}
			if (previouslyFocusedElement?.isConnected) {
				previouslyFocusedElement.focus();
			}
		};
	});
</script>

{#if open}
	<div class="ui-dialog-layer" data-tone={tone}>
		<section
			bind:this={panel}
			class="ui-dialog"
			role={dialogRole}
			aria-modal="true"
			aria-labelledby={titleId}
			aria-describedby={
				description && children
					? `${descriptionId} ${bodyId}`
					: description
						? descriptionId
						: children
							? bodyId
							: undefined
			}
			tabindex="-1"
		>
			<header class="ui-dialog__header">
				<div class="ui-dialog__heading">
					<h2 id={titleId} class="ui-dialog__title">{title}</h2>
					{#if description}
						<p id={descriptionId} class="ui-dialog__description">{description}</p>
					{/if}
				</div>
				{#if showCloseButton}
					<button
						type="button"
						class="ui-dialog__close"
						aria-label={closeLabel}
						onclick={() => onClose?.()}
					>
						×
					</button>
				{/if}
			</header>

			{#if children}
				<div id={bodyId} class="ui-dialog__body">
					{@render children()}
				</div>
			{/if}

			{#if actions}
				<footer class="ui-dialog__footer">
					{@render actions()}
				</footer>
			{/if}
		</section>
	</div>
{/if}

<style>
	.ui-dialog-layer {
		position: fixed;
		inset: 0;
		z-index: 10020;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: clamp(1rem, 3vw, 2rem);
		background:
			radial-gradient(circle at top, rgb(255 255 255 / 0.08), transparent 44%),
			rgba(5, 5, 5, 0.82);
		backdrop-filter: blur(6px);
	}

	.ui-dialog {
		width: min(100%, 34rem);
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.35rem;
		border-radius: var(--ui-radius-lg, 16px);
		border: 1px solid var(--ui-border-strong, rgba(255, 255, 255, 0.22));
		background: var(--ui-surface-raised, #171210);
		box-shadow: none;
	}

	.ui-dialog-layer[data-tone='warning'] .ui-dialog {
		border-color: var(--ui-status-warning-border, rgb(197 139 58 / 0.3));
		background: color-mix(in srgb, var(--ui-surface-raised, #171210) 90%, rgb(197 139 58 / 0.14));
	}

	.ui-dialog-layer[data-tone='danger'] .ui-dialog {
		border-color: var(--ui-status-error-border, rgb(198 106 75 / 0.3));
		background: color-mix(in srgb, var(--ui-surface-raised, #171210) 88%, rgb(198 106 75 / 0.16));
	}

	.ui-dialog__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 1rem;
	}

	.ui-dialog__heading {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.ui-dialog__title {
		margin: 0;
		font-size: 1.2rem;
		line-height: 1.25;
		color: var(--ui-text-primary, #f2e7d5);
	}

	.ui-dialog__description {
		margin: 0;
		color: var(--ui-text-secondary, rgb(242 231 213 / 0.82));
	}

	.ui-dialog__body {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		color: var(--ui-text-secondary, rgb(242 231 213 / 0.82));
	}

	.ui-dialog__footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.65rem;
	}

	.ui-dialog__close {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 999px;
		border: 1px solid var(--ui-border-subtle, rgba(255, 255, 255, 0.18));
		background: var(--ui-layer-interactive, rgba(255, 255, 255, 0.045));
		color: inherit;
		font-size: 1.2rem;
		line-height: 1;
	}

	.ui-dialog__close:hover {
		background: rgba(255, 255, 255, 0.08);
	}

	@media (max-width: 640px) {
		.ui-dialog {
			padding: 1.05rem;
		}

		.ui-dialog__footer {
			flex-direction: column-reverse;
		}

		.ui-dialog__footer :global(button),
		.ui-dialog__footer :global(a) {
			width: 100%;
			justify-content: center;
		}
	}
</style>
