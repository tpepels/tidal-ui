import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type Archetype = 'tool' | 'detail' | 'collection' | 'embed';

type RouteComplianceSpec = {
	route: string;
	archetype: Archetype;
	files: string[];
	requiredBlocks: string[];
};

const ROOT_DIR = process.cwd();

const ROUTE_COMPLIANCE_SPECS: RouteComplianceSpec[] = [
	{
		route: '/',
		archetype: 'collection',
		files: ['src/routes/+page.svelte', 'src/lib/screens/search/SearchScreenContainer.svelte'],
		requiredBlocks: ['page-header', 'results']
	},
	{
		route: '/history',
		archetype: 'collection',
		files: ['src/routes/history/+page.svelte'],
		requiredBlocks: ['page-header', 'filters-actions', 'results']
	},
	{
		route: '/library-suggestions',
		archetype: 'collection',
		files: [
			'src/routes/library-suggestions/+page.svelte',
			'src/lib/components/pages/LibrarySuggestionsPageContent.svelte'
		],
		requiredBlocks: ['page-header', 'filters-actions', 'results']
	},
	{
		route: '/settings',
		archetype: 'tool',
		files: ['src/routes/settings/+page.svelte', 'src/lib/components/pages/SettingsPageContent.svelte'],
		requiredBlocks: ['page-header', 'key-summary', 'primary-actions', 'main-sections']
	},
	{
		route: '/download-center',
		archetype: 'tool',
		files: [
			'src/routes/download-center/+page.svelte',
			'src/lib/screens/download-center/DownloadCenterScreenContainer.svelte',
			'src/lib/components/DownloadManager.svelte',
			'src/lib/components/download-manager/DownloadManagerPanelIntro.svelte'
		],
		requiredBlocks: ['page-header', 'key-summary', 'primary-actions', 'main-sections']
	},
	{
		route: '/download-log',
		archetype: 'tool',
		files: ['src/routes/download-log/+page.svelte', 'src/lib/components/DownloadLog.svelte'],
		requiredBlocks: ['page-header', 'key-summary', 'primary-actions', 'main-sections']
	},
	{
		route: '/status',
		archetype: 'tool',
		files: ['src/routes/status/+page.svelte', 'src/lib/components/pages/StatusPageContent.svelte'],
		requiredBlocks: ['page-header', 'key-summary', 'primary-actions', 'main-sections']
	},
	{
		route: '/album/[id]',
		archetype: 'detail',
		files: ['src/routes/album/[id]/+page.svelte', 'src/lib/components/pages/AlbumPageContent.svelte'],
		requiredBlocks: [
			'back-nav',
			'entity-hero',
			'primary-actions',
			'context-metadata',
			'main-content',
			'secondary-content'
		]
	},
	{
		route: '/artist/[id]',
		archetype: 'detail',
		files: [
			'src/routes/artist/[id]/+page.svelte',
			'src/lib/screens/artist/ArtistScreenContainer.svelte',
			'src/lib/components/artist/ArtistDiscographySection.svelte'
		],
		requiredBlocks: [
			'back-nav',
			'entity-hero',
			'primary-actions',
			'context-metadata',
			'main-content',
			'secondary-content'
		]
	},
	{
		route: '/track/[id]',
		archetype: 'detail',
		files: ['src/routes/track/[id]/+page.svelte', 'src/lib/screens/track/TrackScreenContainer.svelte'],
		requiredBlocks: ['back-nav', 'entity-hero', 'primary-actions', 'context-metadata', 'main-content']
	},
	{
		route: '/playlist/[id]',
		archetype: 'detail',
		files: [
			'src/routes/playlist/[id]/+page.svelte',
			'src/lib/screens/playlist/PlaylistScreenContainer.svelte'
		],
		requiredBlocks: [
			'back-nav',
			'entity-hero',
			'primary-actions',
			'context-metadata',
			'main-content',
			'secondary-content'
		]
	},
	{
		route: '/embed/album/[id]',
		archetype: 'embed',
		files: ['src/routes/embed/album/[id]/+page.svelte'],
		requiredBlocks: ['entity-hero', 'primary-actions', 'main-sections']
	},
	{
		route: '/embed/artist/[id]',
		archetype: 'embed',
		files: ['src/routes/embed/artist/[id]/+page.svelte'],
		requiredBlocks: ['entity-hero', 'primary-actions', 'main-sections']
	},
	{
		route: '/embed/playlist/[id]',
		archetype: 'embed',
		files: ['src/routes/embed/playlist/[id]/+page.svelte'],
		requiredBlocks: ['entity-hero', 'primary-actions', 'main-sections']
	},
	{
		route: '/embed/track/[id]',
		archetype: 'embed',
		files: ['src/routes/embed/track/[id]/+page.svelte'],
		requiredBlocks: ['entity-hero', 'primary-actions', 'main-sections']
	}
];

function loadSources(files: string[]): string {
	return files
		.map((file) => readFileSync(resolve(ROOT_DIR, file), 'utf-8'))
		.join('\n');
}

describe('UI archetype route compliance', () => {
	for (const spec of ROUTE_COMPLIANCE_SPECS) {
		it(`${spec.route} includes archetype and required structural blocks`, () => {
			const source = loadSources(spec.files);
			expect(source).toContain(`data-ui-archetype="${spec.archetype}"`);
			for (const block of spec.requiredBlocks) {
				expect(source).toContain(`data-ui-block="${block}"`);
			}
		});
	}
});
