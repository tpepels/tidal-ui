import { writable, type Writable } from 'svelte/store';
import { browser } from '$app/environment';

export interface BreadcrumbItem {
	label: string;
	href: string;
}

interface BreadcrumbState {
	breadcrumbs: BreadcrumbItem[];
}

const initialState: BreadcrumbState = {
	breadcrumbs: [{ label: 'Home', href: '/' }]
};

const store: Writable<BreadcrumbState> = writable(initialState);

if (browser) {
	const stored = sessionStorage.getItem('tidal-ui-breadcrumbs');
	if (stored) {
		try {
			const data = JSON.parse(stored);
			store.set({
				breadcrumbs: data.breadcrumbs ?? [{ label: 'Home', href: '/' }]
			});
		} catch (e) {
			console.error('Failed to restore breadcrumbs:', e);
		}
	}

	store.subscribe((state) => {
		try {
			sessionStorage.setItem('tidal-ui-breadcrumbs', JSON.stringify(state));
		} catch (e) {
			console.warn('Failed to save breadcrumbs to sessionStorage:', e);
		}
	});
}

export const breadcrumbStore = {
	subscribe: store.subscribe,
	setBreadcrumbs(items: BreadcrumbItem[]) {
		store.update(() => ({
			breadcrumbs: [{ label: 'Home', href: '/' }, ...items]
		}));
	},
	addBreadcrumb(item: BreadcrumbItem) {
		store.update((state) => {
			// Avoid duplicates
			if (state.breadcrumbs.some((b) => b.href === item.href)) {
				return state;
			}
			return {
				breadcrumbs: [...state.breadcrumbs, item]
			};
		});
	},
	clearBreadcrumbs() {
		store.set(initialState);
	}
};
