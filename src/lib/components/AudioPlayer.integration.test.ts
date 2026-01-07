import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readAudioPlayerSource = () =>
	readFileSync(resolve(process.cwd(), 'src/lib/components/AudioPlayer.svelte'), 'utf8');

describe('AudioPlayer integration contract', () => {
	it('routes playback intent through the playback facade', () => {
		const source = readAudioPlayerSource();

		expect(source).toContain("import { playerStore } from '$lib/stores/player';");
		expect(source).toContain("import { playbackMachine } from '$lib/stores/playbackMachine.svelte';");
		expect(source).toContain("import { playbackFacade } from '$lib/controllers/playbackFacade';");
		expect(source).toContain('playbackFacade.play');
		expect(source).toContain('playbackFacade.pause');
		expect(source).toContain('playbackFacade.next');
		expect(source).toContain('playbackFacade.loadQueue');
	});

	it('routes audio element lifecycle events to playbackMachine', () => {
		const source = readAudioPlayerSource();

		expect(source).toContain('playbackMachine.actions.onAudioReady');
		expect(source).toContain('playbackMachine.actions.onAudioPlaying');
		expect(source).toContain('playbackMachine.actions.onAudioPaused');
		expect(source).toContain('playbackMachine.actions.onAudioWaiting');
		expect(source).toContain('playbackMachine.actions.onTrackEnd');
	});
});
