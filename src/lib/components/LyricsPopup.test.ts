import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
	path.resolve(process.cwd(), 'src/lib/components/LyricsPopup.svelte'),
	'utf8'
);

describe('LyricsPopup source contract', () => {
	it('keeps the lyrics panel vertically scrollable as a bounded overlay surface', () => {
		expect(source).toContain('overflow-y: auto;');
		expect(source).toContain('overscroll-behavior: contain;');
	});
});
