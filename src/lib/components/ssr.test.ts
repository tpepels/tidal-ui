// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from 'svelte/compiler';

const compileSsr = (relativePath: string) => {
	const filename = resolve(process.cwd(), relativePath);
	const source = readFileSync(filename, 'utf-8');
	return compile(source, { generate: 'ssr', filename });
};

const compileDom = (relativePath: string) => {
	const filename = resolve(process.cwd(), relativePath);
	const source = readFileSync(filename, 'utf-8');
	return compile(source, { generate: 'dom', hydratable: true, filename });
};

describe('SSR compile', () => {
	it('compiles SearchInterface for SSR', () => {
		const result = compileSsr('src/lib/components/SearchInterface.svelte');
		expect(result.js.code.length).toBeGreaterThan(0);
	});

	it('compiles AudioPlayer for SSR', () => {
		const result = compileSsr('src/lib/components/AudioPlayer.svelte');
		expect(result.js.code.length).toBeGreaterThan(0);
	});

	it('compiles key shared components for SSR', () => {
		const sharedComponents = [
			'src/lib/components/DownloadLog.svelte',
			'src/lib/components/DownloadProgress.svelte',
			'src/lib/components/TrackList.svelte',
			'src/lib/components/LyricsPopup.svelte',
			'src/lib/components/Breadcrumb.svelte',
			'src/lib/components/ToastContainer.svelte',
			'src/lib/components/ErrorBoundary.svelte'
		];

		for (const component of sharedComponents) {
			const result = compileSsr(component);
			expect(result.js.code.length).toBeGreaterThan(0);
		}
	});

	it('compiles core routes for SSR', () => {
		const routes = [
			'src/routes/+layout.svelte',
			'src/routes/+page.svelte',
			'src/routes/album/[id]/+page.svelte',
			'src/routes/artist/[id]/+page.svelte',
			'src/routes/track/[id]/+page.svelte',
			'src/routes/playlist/[id]/+page.svelte'
		];

		for (const route of routes) {
			const result = compileSsr(route);
			expect(result.js.code.length).toBeGreaterThan(0);
		}
	});

	it('compiles layout for hydratable DOM output', () => {
		const result = compileDom('src/routes/+layout.svelte');
		expect(result.js.code.length).toBeGreaterThan(0);
	});
});
