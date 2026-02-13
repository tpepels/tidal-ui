import { writable, type Writable } from 'svelte/store';
import { browser } from '$app/environment';

export interface BreadcrumbItem {
	label: string;
	href: string;
}

interface BreadcrumbState {
	breadcrumbs: BreadcrumbItem[];
}

const HOME_BREADCRUMB: BreadcrumbItem = { label: 'Home', href: '/' };
const MAX_BREADCRUMBS = 10;

const initialState: BreadcrumbState = {
	breadcrumbs: [HOME_BREADCRUMB]
};

function normalizeHref(value: string | null | undefined): string {
	if (!value || value.trim().length === 0) {
		return '/';
	}

	let candidate = value.trim();
	try {
		const parsed = browser ? new URL(candidate, window.location.origin) : new URL(candidate);
		candidate = parsed.pathname;
	} catch {
		if (!candidate.startsWith('/')) {
			candidate = `/${candidate}`;
		}
	}

	if (candidate.length > 1) {
		candidate = candidate.replace(/\/+$/, '');
	}
	return candidate || '/';
}

function toTitleCase(value: string): string {
	return value
		.split(/\s+/)
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

function deriveFallbackLabel(href: string): string {
	if (href === '/') return HOME_BREADCRUMB.label;
	if (href.startsWith('/artist/')) return 'Artist';
	if (href.startsWith('/album/')) return 'Album';
	if (href.startsWith('/track/')) return 'Track';
	if (href.startsWith('/playlist/')) return 'Playlist';
	const segment = href.split('/').filter(Boolean).at(-1) ?? href;
	return toTitleCase(segment.replace(/[-_]+/g, ' '));
}

function normalizeLabel(value: string | null | undefined, fallbackHref: string): string {
	const trimmed = value?.trim() ?? '';
	return trimmed.length > 0 ? trimmed : deriveFallbackLabel(fallbackHref);
}

function ensureHome(crumbs: BreadcrumbItem[]): BreadcrumbItem[] {
	if (crumbs.length === 0) return [HOME_BREADCRUMB];
	if (crumbs[0]?.href === HOME_BREADCRUMB.href) {
		return crumbs;
	}
	return [HOME_BREADCRUMB, ...crumbs];
}

function trimBreadcrumbTrail(crumbs: BreadcrumbItem[]): BreadcrumbItem[] {
	if (crumbs.length <= MAX_BREADCRUMBS) {
		return ensureHome(crumbs);
	}
	const tail = crumbs.slice(-(MAX_BREADCRUMBS - 1));
	return ensureHome(tail);
}

function normalizeState(raw: unknown): BreadcrumbState {
	if (!raw || typeof raw !== 'object') {
		return initialState;
	}

	const candidate = raw as { breadcrumbs?: unknown };
	const rawCrumbs = Array.isArray(candidate.breadcrumbs) ? candidate.breadcrumbs : [];
	const normalized: BreadcrumbItem[] = [];

	for (const entry of rawCrumbs) {
		if (!entry || typeof entry !== 'object') continue;
		const item = entry as Partial<BreadcrumbItem>;
		const href = normalizeHref(typeof item.href === 'string' ? item.href : '/');
		const label = normalizeLabel(typeof item.label === 'string' ? item.label : undefined, href);
		normalized.push({ href, label });
	}

	return { breadcrumbs: trimBreadcrumbTrail(normalized) };
}

const store: Writable<BreadcrumbState> = writable(initialState);

if (browser) {
	const stored = sessionStorage.getItem('tidal-ui-breadcrumbs');
	if (stored) {
		try {
			store.set(normalizeState(JSON.parse(stored)));
		} catch (error) {
			console.error('Failed to restore breadcrumbs:', error);
		}
	}

	store.subscribe((state) => {
		try {
			sessionStorage.setItem('tidal-ui-breadcrumbs', JSON.stringify(state));
		} catch (error) {
			console.warn('Failed to save breadcrumbs to sessionStorage:', error);
		}
	});
}

export const breadcrumbStore = {
	subscribe: store.subscribe,

	visit(href: string, label?: string): void {
		const normalizedHref = normalizeHref(href);
		const hasExplicitLabel = typeof label === 'string' && label.trim().length > 0;
		store.update((state) => {
			if (normalizedHref === HOME_BREADCRUMB.href) {
				return { breadcrumbs: [HOME_BREADCRUMB] };
			}

			const breadcrumbs = [...state.breadcrumbs];
			const resolvedLabel = normalizeLabel(label, normalizedHref);
			const last = breadcrumbs[breadcrumbs.length - 1];
			if (last?.href === normalizedHref) {
				const nextLabel = hasExplicitLabel
					? resolvedLabel
					: normalizeLabel(last.label, normalizedHref);
				breadcrumbs[breadcrumbs.length - 1] = { href: normalizedHref, label: nextLabel };
				return { breadcrumbs: breadcrumbs };
			}

			// Keep breadcrumbs path-relative: revisiting an earlier location trims
			// the trail back to that crumb instead of appending duplicates.
			let existingIndex = -1;
			for (let i = breadcrumbs.length - 1; i >= 0; i -= 1) {
				if (breadcrumbs[i]?.href === normalizedHref) {
					existingIndex = i;
					break;
				}
			}
			if (existingIndex >= 0) {
				const trimmed = breadcrumbs.slice(0, existingIndex + 1);
				if (normalizedHref === HOME_BREADCRUMB.href) {
					trimmed[0] = { ...HOME_BREADCRUMB };
				} else {
					const existingLabel = trimmed[existingIndex]?.label;
					const nextLabel = hasExplicitLabel
						? resolvedLabel
						: normalizeLabel(existingLabel, normalizedHref);
					trimmed[existingIndex] = { href: normalizedHref, label: nextLabel };
				}
				return { breadcrumbs: trimmed };
			}

			return {
				breadcrumbs: trimBreadcrumbTrail([...breadcrumbs, { href: normalizedHref, label: resolvedLabel }])
			};
		});
	},

	setCurrentLabel(label: string, href?: string): void {
		store.update((state) => {
			const targetHref = normalizeHref(href ?? state.breadcrumbs[state.breadcrumbs.length - 1]?.href ?? '/');
			const resolvedLabel = normalizeLabel(label, targetHref);
			const breadcrumbs = [...state.breadcrumbs];
			let index = -1;
			for (let i = breadcrumbs.length - 1; i >= 0; i -= 1) {
				if (breadcrumbs[i]?.href === targetHref) {
					index = i;
					break;
				}
			}
			if (index >= 0) {
				breadcrumbs[index] = { ...breadcrumbs[index]!, label: resolvedLabel };
				return { breadcrumbs: breadcrumbs };
			}
			if (targetHref === HOME_BREADCRUMB.href) {
				return { breadcrumbs: [{ ...HOME_BREADCRUMB, label: resolvedLabel }] };
			}
			return {
				breadcrumbs: trimBreadcrumbTrail([...breadcrumbs, { href: targetHref, label: resolvedLabel }])
			};
		});
	},

	setLabel(href: string, label: string): void {
		const targetHref = normalizeHref(href);
		const resolvedLabel = normalizeLabel(label, targetHref);
		store.update((state) => {
			if (!state.breadcrumbs.some((crumb) => crumb.href === targetHref)) {
				return state;
			}
			const breadcrumbs = state.breadcrumbs.map((crumb) =>
				crumb.href === targetHref ? { ...crumb, label: resolvedLabel } : crumb
			);
			return { breadcrumbs };
		});
	},

	goBack(currentHref: string, fallbackHref = '/'): string {
		const normalizedCurrent = normalizeHref(currentHref);
		let target = normalizeHref(fallbackHref);

		store.update((state) => {
			const breadcrumbs = [...state.breadcrumbs];
			if (breadcrumbs.length <= 1) {
				target = normalizeHref(fallbackHref);
				return { breadcrumbs: [HOME_BREADCRUMB] };
			}

			let indexInTrail = -1;
			for (let i = breadcrumbs.length - 1; i >= 0; i -= 1) {
				if (breadcrumbs[i]?.href === normalizedCurrent) {
					indexInTrail = i;
					break;
				}
			}
			const currentIndex = indexInTrail >= 0 ? indexInTrail : breadcrumbs.length - 1;
			if (currentIndex <= 0) {
				target = normalizeHref(fallbackHref);
				return { breadcrumbs: [HOME_BREADCRUMB] };
			}

			target = breadcrumbs[currentIndex - 1]!.href;
			return { breadcrumbs: breadcrumbs.slice(0, currentIndex) };
		});

		return target;
	},

	clearBreadcrumbs(): void {
		store.set(initialState);
	}
};
