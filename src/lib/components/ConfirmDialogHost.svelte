<script lang="ts">
	import AppDialog from '$lib/components/ui/AppDialog.svelte';
	import { confirmDialog } from '$lib/stores/dialogs';
</script>

{#if $confirmDialog}
	<AppDialog
		open={true}
		title={$confirmDialog.title}
		description={$confirmDialog.body}
		tone={$confirmDialog.tone}
		dialogRole="dialog"
		initialFocusSelector='[data-dialog-action="cancel"]'
		onClose={confirmDialog.cancel}
	>
		{#snippet actions()}
			<button
				type="button"
				class="ui-chip-button"
				data-dialog-action="cancel"
				onclick={confirmDialog.cancel}
			>
				{$confirmDialog.cancelLabel}
			</button>
			<button
				type="button"
				class={`ui-chip-button ui-confirm-dialog__confirm ${$confirmDialog.tone === 'danger' ? 'ui-confirm-dialog__confirm--danger' : ''}`.trim()}
				data-tone={$confirmDialog.tone === 'danger' ? undefined : 'secondary'}
				data-dialog-action="confirm"
				onclick={confirmDialog.accept}
			>
				{$confirmDialog.confirmLabel}
			</button>
		{/snippet}
	</AppDialog>
{/if}

<style>
	.ui-confirm-dialog__confirm--danger {
		border-color: var(--ui-status-error-border, rgba(255, 159, 151, 0.28));
		background: var(--ui-status-error-soft, rgba(255, 159, 151, 0.14));
		color: rgba(255, 228, 225, 0.96);
	}

	.ui-confirm-dialog__confirm--danger:hover {
		border-color: rgba(255, 159, 151, 0.44);
		background: rgba(255, 159, 151, 0.2);
	}
</style>
