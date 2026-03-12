import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT_DIR = process.cwd();
const SRC_DIR = resolve(ROOT_DIR, 'src');
const ALLOWED_EXTENSIONS = new Set(['.svelte', '.ts', '.js', '.css']);

function collectSourceFiles(dir: string): string[] {
	const entries = readdirSync(dir);
	const files: string[] = [];
	for (const entry of entries) {
		const absolutePath = resolve(dir, entry);
		const stats = statSync(absolutePath);
		if (stats.isDirectory()) {
			files.push(...collectSourceFiles(absolutePath));
			continue;
		}
		const extension = extname(absolutePath);
		if (ALLOWED_EXTENSIONS.has(extension)) {
			files.push(absolutePath);
		}
	}
	return files;
}

describe('UI legacy class guard', () => {
	it('does not use deprecated glass-* classes in src/', () => {
		const offending: string[] = [];
		const legacyPrefix = ['glass', '-'].join('');
		for (const file of collectSourceFiles(SRC_DIR)) {
			if (file.endsWith('uiLegacyClasses.test.ts')) {
				continue;
			}
			const source = readFileSync(file, 'utf-8');
			if (source.includes(legacyPrefix)) {
				offending.push(file.replace(`${ROOT_DIR}/`, ''));
			}
		}
		expect(offending).toEqual([]);
	});
});
