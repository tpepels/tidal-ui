export type AppRouteMeta = {
	path: string;
	title: string;
	subtitle?: string;
	navLabel?: string;
	navGroup?: 'navigation' | 'tools';
	archetype: 'tool' | 'detail' | 'collection' | 'embed';
	sectionPriority: string[];
};

const ROUTES: AppRouteMeta[] = [
	{
		path: '/',
		title: 'Browse & Search',
		subtitle: 'Browse and search music',
		navLabel: 'Browse & Search',
		navGroup: 'navigation',
		archetype: 'collection',
		sectionPriority: ['page-header', 'filters-actions', 'results', 'state-feedback']
	},
	{
		path: '/history',
		title: 'History',
		subtitle: 'Recently visited artists and albums',
		navLabel: 'History',
		navGroup: 'navigation',
		archetype: 'collection',
		sectionPriority: ['page-header', 'filters-actions', 'results', 'state-feedback']
	},
	{
		path: '/library-suggestions',
		title: 'Library Suggestions',
		subtitle: 'Common library artists and API-powered discovery picks',
		navLabel: 'Library Suggestions',
		navGroup: 'navigation',
		archetype: 'collection',
		sectionPriority: ['page-header', 'filters-actions', 'results', 'state-feedback']
	},
	{
		path: '/settings',
		title: 'Settings',
		subtitle: 'Streaming, downloads, and maintenance',
		navLabel: 'Settings',
		navGroup: 'tools',
		archetype: 'tool',
		sectionPriority: ['page-header', 'key-summary', 'primary-actions', 'main-sections']
	},
	{
		path: '/download-center',
		title: 'Download Center',
		subtitle: 'Live queue monitoring and controls',
		navLabel: 'Download Center',
		navGroup: 'tools',
		archetype: 'tool',
		sectionPriority: ['page-header', 'key-summary', 'primary-actions', 'main-sections']
	},
	{
		path: '/download-log',
		title: 'Download Log',
		subtitle: 'Live download events and maintenance logs',
		navLabel: 'Download Log',
		navGroup: 'tools',
		archetype: 'tool',
		sectionPriority: ['page-header', 'key-summary', 'primary-actions', 'main-sections']
	},
	{
		path: '/status',
		title: 'Status',
		subtitle: 'System diagnostics and health',
		navLabel: 'Status',
		navGroup: 'tools',
		archetype: 'tool',
		sectionPriority: ['page-header', 'key-summary', 'primary-actions', 'main-sections']
	}
];

const ROUTE_BY_PATH = new Map<string, AppRouteMeta>(ROUTES.map((route) => [route.path, route]));

export function getRouteMeta(pathname: string): AppRouteMeta | null {
	if (ROUTE_BY_PATH.has(pathname)) {
		return ROUTE_BY_PATH.get(pathname) ?? null;
	}

	for (const route of ROUTES) {
		if (route.path !== '/' && pathname.startsWith(`${route.path}/`)) {
			return route;
		}
	}

	return null;
}

export function resolveRouteArchetype(pathname: string): AppRouteMeta['archetype'] {
	const routeMeta = getRouteMeta(pathname);
	if (routeMeta) {
		return routeMeta.archetype;
	}
	if (pathname.startsWith('/embed/')) {
		return 'embed';
	}
	if (
		pathname.startsWith('/artist/') ||
		pathname.startsWith('/album/') ||
		pathname.startsWith('/track/') ||
		pathname.startsWith('/playlist/')
	) {
		return 'detail';
	}
	return 'collection';
}

export function resolveRouteSectionPriority(pathname: string): string[] {
	const routeMeta = getRouteMeta(pathname);
	if (routeMeta) {
		return routeMeta.sectionPriority;
	}
	if (pathname.startsWith('/embed/')) {
		return ['entity-hero', 'primary-actions', 'main-sections', 'state-feedback'];
	}
	if (
		pathname.startsWith('/artist/') ||
		pathname.startsWith('/album/') ||
		pathname.startsWith('/track/') ||
		pathname.startsWith('/playlist/')
	) {
		return [
			'back-nav',
			'entity-hero',
			'primary-actions',
			'context-metadata',
			'main-content',
			'secondary-content'
		];
	}
	return ['page-header', 'filters-actions', 'results', 'state-feedback'];
}

export const appRoutes = ROUTES;
