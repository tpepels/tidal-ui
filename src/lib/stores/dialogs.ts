import { writable } from 'svelte/store';
import type { DialogTone } from '$lib/presentation/viewModels';

export type ConfirmDialogOptions = {
	title: string;
	body: string;
	confirmLabel?: string;
	cancelLabel?: string;
	tone?: DialogTone;
};

type ActiveConfirmDialog = ConfirmDialogOptions & {
	id: string;
};

type PendingResolve = (value: boolean) => void;

function createConfirmDialogStore() {
	const { subscribe, set } = writable<ActiveConfirmDialog | null>(null);
	let pendingResolve: PendingResolve | null = null;

	function clear(value: boolean): void {
		const resolve = pendingResolve;
		pendingResolve = null;
		set(null);
		resolve?.(value);
	}

	function confirm(options: ConfirmDialogOptions): Promise<boolean> {
		if (typeof window === 'undefined') {
			return Promise.resolve(true);
		}

		if (pendingResolve) {
			clear(false);
		}

		return new Promise<boolean>((resolve) => {
			pendingResolve = resolve;
			set({
				id: `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
				confirmLabel: 'Confirm',
				cancelLabel: 'Cancel',
				tone: 'default',
				...options
			});
		});
	}

	return {
		subscribe,
		confirm,
		accept: () => clear(true),
		cancel: () => clear(false)
	};
}

export const confirmDialog = createConfirmDialogStore();
export const confirm = confirmDialog.confirm;
