import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import ConfirmDialogHost from './ConfirmDialogHost.svelte';
import { confirm, confirmDialog } from '$lib/stores/dialogs';

function mountAppShell(): HTMLButtonElement {
	const shell = document.createElement('div');
	shell.setAttribute('data-dialog-app-shell', '');
	const trigger = document.createElement('button');
	trigger.textContent = 'Open dialog';
	shell.append(trigger);
	document.body.append(shell);
	return trigger;
}

afterEach(() => {
	confirmDialog.cancel();
	document.querySelector('[data-dialog-app-shell]')?.remove();
});

describe('ConfirmDialogHost', () => {
	it('resolves cancellation, traps focus, and restores focus', async () => {
		const user = userEvent.setup();
		const trigger = mountAppShell();
		trigger.focus();

		render(ConfirmDialogHost);

		const pending = confirm({
			title: 'Clear queue?',
			body: 'Remove all queued tracks?',
			confirmLabel: 'Clear queue',
			cancelLabel: 'Keep queue',
			tone: 'danger'
		});

		const dialog = await screen.findByRole('dialog');
		expect(dialog.textContent).toContain('Clear queue?');
		expect(dialog.textContent).toContain('Remove all queued tracks?');

		const cancelButton = screen.getByRole('button', { name: 'Keep queue' });
		const confirmButton = screen.getByRole('button', { name: 'Clear queue' });

		await waitFor(() => {
			expect(document.activeElement).toBe(cancelButton);
		});
		await user.tab();
		expect(document.activeElement).toBe(confirmButton);
		await user.tab();
		expect(document.activeElement).toBe(cancelButton);

		await user.click(cancelButton);
		await expect(pending).resolves.toBe(false);
		await waitFor(() => {
			expect(screen.queryByRole('dialog')).toBeNull();
		});
		expect(document.activeElement).toBe(trigger);
	});

	it('resolves true on confirm', async () => {
		const user = userEvent.setup();
		mountAppShell();

		render(ConfirmDialogHost);

		const pending = confirm({
			title: 'Stop downloads?',
			body: 'Stop the active jobs now?',
			confirmLabel: 'Stop downloads',
			cancelLabel: 'Keep running',
			tone: 'danger'
		});

		await user.click(await screen.findByRole('button', { name: 'Stop downloads' }));
		await expect(pending).resolves.toBe(true);
	});
});
