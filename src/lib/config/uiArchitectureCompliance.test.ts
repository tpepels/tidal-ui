import { readdirSync, readFileSync, statSync } from 'node:fs';
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

const ROOT = process.cwd();
const MAIN_ROUTE_FILES = [
	'src/routes/+page.svelte',
	'src/routes/album/[id]/+page.svelte',
	'src/routes/artist/[id]/+page.svelte',
	'src/routes/track/[id]/+page.svelte',
	'src/routes/playlist/[id]/+page.svelte',
	'src/routes/download-center/+page.svelte',
	'src/routes/library-suggestions/+page.svelte'
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
			expect(source).not.toMatch(/\blosslessAPI\b/);
			expect(source).not.toMatch(/\$lib\/api(?:['/])/);
		}
	});
});
