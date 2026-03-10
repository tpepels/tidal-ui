export type AppRouteMeta = {
	path: string;
	title: string;
	subtitle?: string;
	navLabel?: string;
	navGroup?: 'navigation' | 'tools';
};

const ROUTES: AppRouteMeta[] = [
	{
		path: '/',
		title: 'Browse & Search',
		subtitle: 'Browse and search music',
		navLabel: 'Browse & Search',
		navGroup: 'navigation'
	},
	{
		path: '/history',
		title: 'History',
		subtitle: 'Recently visited artists and albums',
		navLabel: 'History',
		navGroup: 'navigation'
	},
	{
		path: '/settings',
		title: 'Settings',
		subtitle: 'Streaming, downloads, and maintenance',
		navLabel: 'Settings',
		navGroup: 'tools'
	},
	{
		path: '/download-center',
		title: 'Download Center',
		subtitle: 'Live queue monitoring and controls',
		navLabel: 'Download Center',
		navGroup: 'tools'
	},
	{
		path: '/download-log',
		title: 'Download Log',
		subtitle: 'Live download events and maintenance logs',
		navLabel: 'Download Log',
		navGroup: 'tools'
	},
	{
		path: '/status',
		title: 'Status',
		subtitle: 'System diagnostics and health',
		navLabel: 'Status',
		navGroup: 'tools'
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

export const appRoutes = ROUTES;
