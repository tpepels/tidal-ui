import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readAudioPlayerSource = () =>
	readFileSync(resolve(process.cwd(), 'src/lib/components/AudioPlayer.svelte'), 'utf8');

describe('AudioPlayer machine-first contract', () => {
	it('does not use store→machine sync subscription', () => {
		const source = readAudioPlayerSource();
		expect(source).not.toContain('playerStore.subscribe(syncFromPlayerState)');
	});
});
