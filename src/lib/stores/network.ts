import { writable } from 'svelte/store';

const isBrowser = typeof navigator !== 'undefined';
const initialOnline = isBrowser ? navigator.onLine : true;

export const networkStatus = writable<{ online: boolean; lastOnline?: Date }>({
	online: initialOnline,
	lastOnline: initialOnline ? new Date() : undefined
});

// Update on events
if (typeof window !== 'undefined') {
	const updateStatus = () => {
		const online = navigator.onLine;
		networkStatus.set({
			online,
			lastOnline: online ? new Date() : undefined
		});
	};

	window.addEventListener('online', updateStatus);
	window.addEventListener('offline', updateStatus);
}
