import { toasts } from '$lib/stores/toasts';
import { trackError, type ErrorContext } from '$lib/core/errorTracker';

export interface DownloadNotificationPort {
	notify: (type: 'success' | 'error', message: string) => void;
	trackError: (error: Error, context: ErrorContext) => void;
}

export const createDownloadNotificationPort = (): DownloadNotificationPort => ({
	notify: (type, message) => toasts[type](message),
	trackError: (error, context) => {
		trackError(error, context);
	}
});
