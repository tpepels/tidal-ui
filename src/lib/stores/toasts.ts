import { writable } from 'svelte/store';

export interface Toast {
	id: string;
	type: 'success' | 'error' | 'warning' | 'info';
	message: string;
	duration?: number;
	action?: {
		label: string;
		handler: () => void;
	};
}

const createToastStore = () => {
	const { subscribe, update } = writable<Toast[]>([]);

	const add = (toast: Omit<Toast, 'id'>) => {
		const id = Math.random().toString(36).substr(2, 9);
		const newToast = { ...toast, id };

		update((toasts) => [...toasts, newToast]);

		// Auto-remove after duration
		setTimeout(() => {
			remove(id);
		}, toast.duration || 5000);

		return id;
	};

	const remove = (id: string) => {
		update((toasts) => toasts.filter((t) => t.id !== id));
	};

	const success = (message: string, options?: Partial<Toast>) =>
		add({ type: 'success', message, ...options });
	const error = (message: string, options?: Partial<Toast>) =>
		add({ type: 'error', message, ...options });
	const warning = (message: string, options?: Partial<Toast>) =>
		add({ type: 'warning', message, ...options });
	const info = (message: string, options?: Partial<Toast>) =>
		add({ type: 'info', message, ...options });

	return {
		subscribe,
		add,
		remove,
		success,
		error,
		warning,
		info
	};
};

export const toasts = createToastStore();
