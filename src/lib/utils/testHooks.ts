export const areTestHooksEnabled = (): boolean => {
	if (import.meta.env.DEV || import.meta.env.VITE_E2E === 'true') {
		return true;
	}
	if (typeof window === 'undefined') {
		return false;
	}
	const host = window.location.hostname;
	return host === 'localhost' || host === '127.0.0.1';
};
