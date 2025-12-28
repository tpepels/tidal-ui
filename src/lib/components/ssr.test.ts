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

describe('SSR compile', () => {
	it('compiles SearchInterface for SSR', () => {
		const result = compileSsr('src/lib/components/SearchInterface.svelte');
		expect(result.js.code.length).toBeGreaterThan(0);
	});

	it('compiles AudioPlayer for SSR', () => {
		const result = compileSsr('src/lib/components/AudioPlayer.svelte');
		expect(result.js.code.length).toBeGreaterThan(0);
	});
});
