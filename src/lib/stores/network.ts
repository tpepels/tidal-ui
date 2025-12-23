import { writable } from 'svelte/store';

export const networkStatus = writable<{ online: boolean; lastOnline?: Date }>({
	online: navigator.onLine,
	lastOnline: navigator.onLine ? new Date() : undefined
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
