import { writable, type Writable } from 'svelte/store';
import { browser } from '$app/environment';
import { getRouteMeta } from '$lib/config/routeMeta';

export interface BreadcrumbItem {
	label: string;
	href: string;
}

interface BreadcrumbState {
	currentHref: string;
	breadcrumbs: BreadcrumbItem[];
	labels: Record<string, string>;
	parents: Record<string, string>;
}

const HOME_BREADCRUMB: BreadcrumbItem = { label: 'Home', href: '/' };
const MAX_BREADCRUMBS = 10;

const initialState: BreadcrumbState = {
	currentHref: HOME_BREADCRUMB.href,
	breadcrumbs: [HOME_BREADCRUMB],
	labels: {},
	parents: {}
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
	const routeMeta = getRouteMeta(href);
	if (routeMeta?.path === href) {
		return routeMeta.navLabel ?? routeMeta.title;
	}
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

function normalizeLabelMap(raw: unknown): Record<string, string> {
	if (!raw || typeof raw !== 'object') {
		return {};
	}
	const labels: Record<string, string> = {};
	for (const [rawHref, rawLabel] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof rawLabel !== 'string') continue;
		const href = normalizeHref(rawHref);
		labels[href] = normalizeLabel(rawLabel, href);
	}
	return labels;
}

function normalizeParentMap(raw: unknown): Record<string, string> {
	if (!raw || typeof raw !== 'object') {
		return {};
	}
	const parents: Record<string, string> = {};
	for (const [rawChild, rawParent] of Object.entries(raw as Record<string, unknown>)) {
		if (typeof rawParent !== 'string') continue;
		const child = normalizeHref(rawChild);
		if (child === HOME_BREADCRUMB.href) continue;
		const parent = normalizeHref(rawParent);
		if (child === parent) continue;
		parents[child] = parent;
	}
	return parents;
}

function resolveParentHref(href: string, parents: Record<string, string>): string | null {
	if (href === HOME_BREADCRUMB.href) {
		return null;
	}
	const explicitParent = parents[href];
	if (explicitParent && explicitParent !== href) {
		return explicitParent;
	}

	const segments = href.split('/').filter(Boolean);
	if (segments.length > 1) {
		const candidate = `/${segments.slice(0, -1).join('/')}`;
		if (candidate === HOME_BREADCRUMB.href || getRouteMeta(candidate)?.path === candidate) {
			return candidate;
		}
	}

	const routeMeta = getRouteMeta(href);
	if (routeMeta?.path && routeMeta.path !== HOME_BREADCRUMB.href) {
		if (href === routeMeta.path) {
			return HOME_BREADCRUMB.href;
		}
		if (href.startsWith(`${routeMeta.path}/`)) {
			return routeMeta.path;
		}
	}

	return HOME_BREADCRUMB.href;
}

function resolveLabel(href: string, labels: Record<string, string>): string {
	if (href === HOME_BREADCRUMB.href) {
		return HOME_BREADCRUMB.label;
	}
	const existingLabel = labels[href];
	if (existingLabel && existingLabel.trim().length > 0) {
		return existingLabel;
	}
	return deriveFallbackLabel(href);
}

function trimHrefs(hrefs: string[]): string[] {
	if (hrefs.length <= MAX_BREADCRUMBS) {
		return hrefs;
	}
	const tail = hrefs.slice(-(MAX_BREADCRUMBS - 1));
	return [HOME_BREADCRUMB.href, ...tail.filter((href) => href !== HOME_BREADCRUMB.href)];
}

function buildBreadcrumbs(currentHref: string, labels: Record<string, string>, parents: Record<string, string>): BreadcrumbItem[] {
	const normalizedCurrent = normalizeHref(currentHref);
	if (normalizedCurrent === HOME_BREADCRUMB.href) {
		return [HOME_BREADCRUMB];
	}

	const chain = [normalizedCurrent];
	const visited = new Set(chain);
	let cursor = normalizedCurrent;
	while (chain.length < MAX_BREADCRUMBS) {
		const parent = resolveParentHref(cursor, parents);
		if (!parent || visited.has(parent)) {
			break;
		}
		chain.push(parent);
		visited.add(parent);
		cursor = parent;
		if (parent === HOME_BREADCRUMB.href) {
			break;
		}
	}

	const ordered = chain.reverse();
	if (ordered[0] !== HOME_BREADCRUMB.href) {
		ordered.unshift(HOME_BREADCRUMB.href);
	}
	const trimmed = trimHrefs(ordered);
	return trimmed.map((href) => ({
		href,
		label: resolveLabel(href, labels)
	}));
}

function normalizeState(raw: unknown): BreadcrumbState {
	if (!raw || typeof raw !== 'object') {
		return initialState;
	}

	const candidate = raw as {
		currentHref?: unknown;
		breadcrumbs?: unknown;
		labels?: unknown;
		parents?: unknown;
	};
	const labels = normalizeLabelMap(candidate.labels);
	const parents = normalizeParentMap(candidate.parents);
	let currentHref = normalizeHref(typeof candidate.currentHref === 'string' ? candidate.currentHref : '/');

	const rawCrumbs = Array.isArray(candidate.breadcrumbs) ? candidate.breadcrumbs : [];
	let lastCrumbHref: string | null = null;

	for (const entry of rawCrumbs) {
		if (!entry || typeof entry !== 'object') continue;
		const item = entry as Partial<BreadcrumbItem>;
		const href = normalizeHref(typeof item.href === 'string' ? item.href : '/');
		const label = normalizeLabel(typeof item.label === 'string' ? item.label : undefined, href);
		labels[href] = label;
		lastCrumbHref = href;
	}

	if (!candidate.currentHref && lastCrumbHref) {
		currentHref = lastCrumbHref;
	}

	return {
		currentHref,
		labels,
		parents,
		breadcrumbs: buildBreadcrumbs(currentHref, labels, parents)
	};
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
		store.update((state) => {
			const labels = { ...state.labels };
			if (typeof label === 'string' && label.trim().length > 0) {
				labels[normalizedHref] = normalizeLabel(label, normalizedHref);
			}
			return {
				currentHref: normalizedHref,
				labels,
				parents: state.parents,
				breadcrumbs: buildBreadcrumbs(normalizedHref, labels, state.parents)
			};
		});
	},

	setCurrentLabel(label: string, href?: string): void {
		store.update((state) => {
			const targetHref = normalizeHref(href ?? state.currentHref ?? '/');
			const resolvedLabel = normalizeLabel(label, targetHref);
			const labels = { ...state.labels, [targetHref]: resolvedLabel };
			const currentHref = state.currentHref ?? HOME_BREADCRUMB.href;
			return {
				currentHref,
				labels,
				parents: state.parents,
				breadcrumbs: buildBreadcrumbs(currentHref, labels, state.parents)
			};
		});
	},

	setLabel(href: string, label: string): void {
		const targetHref = normalizeHref(href);
		const resolvedLabel = normalizeLabel(label, targetHref);
		store.update((state) => {
			const labels = { ...state.labels, [targetHref]: resolvedLabel };
			const currentHref = state.currentHref ?? HOME_BREADCRUMB.href;
			return {
				currentHref,
				labels,
				parents: state.parents,
				breadcrumbs: buildBreadcrumbs(currentHref, labels, state.parents)
			};
		});
	},

	setParent(childHref: string, parentHref: string): void {
		const normalizedChild = normalizeHref(childHref);
		const normalizedParent = normalizeHref(parentHref);
		if (normalizedChild === HOME_BREADCRUMB.href || normalizedChild === normalizedParent) {
			return;
		}
		store.update((state) => {
			const parents = { ...state.parents, [normalizedChild]: normalizedParent };
			const currentHref = state.currentHref ?? HOME_BREADCRUMB.href;
			return {
				currentHref,
				labels: state.labels,
				parents,
				breadcrumbs: buildBreadcrumbs(currentHref, state.labels, parents)
			};
		});
	},

	goBack(currentHref: string, fallbackHref = '/'): string {
		const normalizedCurrent = normalizeHref(currentHref);
		let target = normalizeHref(fallbackHref);

		store.update((state) => {
			const sourceHref = normalizedCurrent || state.currentHref || HOME_BREADCRUMB.href;
			const currentTrail = buildBreadcrumbs(sourceHref, state.labels, state.parents);
			target = currentTrail.length > 1 ? currentTrail[currentTrail.length - 2]!.href : normalizeHref(fallbackHref);
			return {
				currentHref: target,
				labels: state.labels,
				parents: state.parents,
				breadcrumbs: buildBreadcrumbs(target, state.labels, state.parents)
			};
		});

		return target;
	},

	clearBreadcrumbs(): void {
		store.set(initialState);
	}
};
