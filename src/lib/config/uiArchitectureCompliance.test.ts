import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function collectSvelteFiles(dir: string): string[] {
	const entries = readdirSync(dir);
	const files: string[] = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry);
		const stats = statSync(fullPath);
		if (stats.isDirectory()) {
			files.push(...collectSvelteFiles(fullPath));
			continue;
		}
		if (fullPath.endsWith('.svelte')) {
			files.push(fullPath);
		}
	}

	return files;
}

function collectCodeFiles(dir: string): string[] {
	const entries = readdirSync(dir);
	const files: string[] = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry);
		const stats = statSync(fullPath);
		if (stats.isDirectory()) {
			files.push(...collectCodeFiles(fullPath));
			continue;
		}
		if (fullPath.endsWith('.svelte') || fullPath.endsWith('.ts')) {
			files.push(fullPath);
		}
	}

	return files;
}

const ROOT = process.cwd();
const MAIN_ROUTE_FILES = [
	'src/routes/+page.svelte',
	'src/routes/album/[id]/+page.svelte',
	'src/routes/artist/[id]/+page.svelte',
	'src/routes/track/[id]/+page.svelte',
	'src/routes/playlist/[id]/+page.svelte',
	'src/routes/download-center/+page.svelte',
	'src/routes/library-suggestions/+page.svelte',
	'src/routes/settings/+page.svelte',
	'src/routes/status/+page.svelte'
];
const BANNED_PRESENTATION_IMPORTS = [
	/\$lib\/stores\//,
	/\$lib\/api(?:['/])/,
	/\$lib\/downloads(?:['/])/,
	/\$lib\/controllers\//,
	/\$lib\/features\//,
	/\$app\/stores/,
	/\$app\/navigation/
];
const MAJOR_SCREEN_DIRS = [
	'src/lib/screens/album',
	'src/lib/screens/artist',
	'src/lib/screens/download-center',
	'src/lib/screens/playlist',
	'src/lib/screens/search',
	'src/lib/screens/track'
];
const FORBIDDEN_LEGACY_IMPORTS = [
	/components\/artist\/ArtistRecommendationsRail\.svelte/,
	/components\/artist\/ArtistDiscographyHighlights\.svelte/,
	/components\/download-manager\/DownloadManagerPanelIntro\.svelte/,
	/components\/download-manager\/DownloadManagerPriorityOverview\.svelte/,
	/components\/download-manager\/DownloadManagerDetailedSections\.svelte/,
	/routes\/api\/download-track\/_shared/
];
const REMOVED_LEGACY_FILES = [
	'src/lib/components/artist/ArtistRecommendationsRail.svelte',
	'src/lib/components/artist/ArtistDiscographyHighlights.svelte',
	'src/lib/components/download-manager/DownloadManagerPanelIntro.svelte',
	'src/lib/components/download-manager/DownloadManagerPriorityOverview.svelte',
	'src/lib/components/download-manager/DownloadManagerDetailedSections.svelte',
	'src/routes/api/download-track/_shared.ts',
	'src/routes/api/download-track/_shared.test.ts'
];

describe('UI architecture compliance', () => {
	it('keeps main route files as thin screen-container shells', () => {
		for (const relativeFile of MAIN_ROUTE_FILES) {
			const source = readFileSync(path.resolve(ROOT, relativeFile), 'utf8');
			expect(source).toMatch(/ScreenContainer\.svelte/);
			for (const pattern of BANNED_PRESENTATION_IMPORTS) {
				expect(source).not.toMatch(pattern);
			}
		}
	});

	it('keeps components/ui free of app orchestration imports', () => {
		const uiFiles = collectSvelteFiles(path.resolve(ROOT, 'src/lib/components/ui'));

		for (const file of uiFiles) {
			const source = readFileSync(file, 'utf8');
			for (const pattern of BANNED_PRESENTATION_IMPORTS) {
				expect(source).not.toMatch(pattern);
			}
		}
	});

	it('prevents screen sections from importing losslessAPI directly', () => {
		const sectionFiles = collectSvelteFiles(path.resolve(ROOT, 'src/lib/screens')).filter((file) =>
			file.includes(`${path.sep}sections${path.sep}`)
		);

		for (const file of sectionFiles) {
			const source = readFileSync(file, 'utf8');
			for (const pattern of BANNED_PRESENTATION_IMPORTS) {
				expect(source).not.toMatch(pattern);
			}
		}
	});

	it('requires major screens to expose section directories', () => {
		for (const relativeDir of MAJOR_SCREEN_DIRS) {
			const absoluteDir = path.resolve(ROOT, relativeDir);
			expect(statSync(absoluteDir).isDirectory()).toBe(true);
			const sectionDir = path.join(absoluteDir, 'sections');
			expect(statSync(sectionDir).isDirectory()).toBe(true);
			expect(collectSvelteFiles(sectionDir).length).toBeGreaterThan(0);
		}
	});

	it('keeps album and download-center routes off the legacy monoliths', () => {
		const albumScreenSource = readFileSync(
			path.resolve(ROOT, 'src/lib/screens/album/AlbumScreenContainer.svelte'),
			'utf8'
		);
		const downloadCenterSource = readFileSync(
			path.resolve(ROOT, 'src/lib/screens/download-center/DownloadCenterScreenContainer.svelte'),
			'utf8'
		);

		expect(albumScreenSource).not.toMatch(/AlbumPageContent\.svelte/);
		expect(downloadCenterSource).not.toMatch(/DownloadManager\.svelte/);
	});

	it('keeps screen and shell entrypoints off removed legacy component paths', () => {
		const searchScreenSource = readFileSync(
			path.resolve(ROOT, 'src/lib/screens/search/SearchScreenContainer.svelte'),
			'utf8'
		);
		const librarySuggestionsSource = readFileSync(
			path.resolve(ROOT, 'src/lib/screens/library-suggestions/LibrarySuggestionsScreenContainer.svelte'),
			'utf8'
		);
		const artistDiscographySource = readFileSync(
			path.resolve(ROOT, 'src/lib/screens/artist/sections/ArtistDiscographySection.svelte'),
			'utf8'
		);
		const layoutSource = readFileSync(path.resolve(ROOT, 'src/routes/+layout.svelte'), 'utf8');

		expect(searchScreenSource).not.toMatch(/SearchInterface\.svelte/);
		expect(librarySuggestionsSource).not.toMatch(/LibrarySuggestionsPageContent\.svelte/);
		expect(artistDiscographySource).not.toMatch(/components\/artist\/ArtistDiscographySection\.svelte/);
		expect(layoutSource).not.toMatch(/components\/DownloadManager\.svelte/);
	});

	it('keeps removed legacy adapter and shim paths out of runtime source', () => {
		const runtimeSources = [
			...collectCodeFiles(path.resolve(ROOT, 'src/lib/screens')),
			...collectCodeFiles(path.resolve(ROOT, 'src/lib/shell')),
			...collectCodeFiles(path.resolve(ROOT, 'src/routes'))
		];

		for (const file of runtimeSources) {
			const source = readFileSync(file, 'utf8');
			for (const pattern of FORBIDDEN_LEGACY_IMPORTS) {
				expect(source).not.toMatch(pattern);
			}
		}
	});

	it('keeps removed legacy adapter and shim files deleted', () => {
		for (const relativeFile of REMOVED_LEGACY_FILES) {
			expect(existsSync(path.resolve(ROOT, relativeFile))).toBe(false);
		}
	});
});
