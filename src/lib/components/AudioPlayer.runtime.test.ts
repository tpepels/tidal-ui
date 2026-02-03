import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readAudioPlayerSource = () =>
	readFileSync(resolve(process.cwd(), 'src/lib/components/AudioPlayer.svelte'), 'utf8');

describe('AudioPlayer machine-first contract', () => {
	it('does not reference legacy store sync', () => {
		const source = readAudioPlayerSource();
		const legacyToken = ['player', 'Store'].join('');
		expect(source).not.toContain(legacyToken);
	});
});
