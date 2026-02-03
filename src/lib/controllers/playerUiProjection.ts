import { playbackMachine } from '$lib/stores/playbackMachine.svelte';

export const playerUiProjection = {
	setDuration(duration: number) {
		playbackMachine.actions.updateDuration(duration);
	},
	setCurrentTime(time: number) {
		playbackMachine.actions.updateTime(time);
	},
	setVolume(volume: number) {
		playbackMachine.actions.updateVolume(volume);
	},
	setSampleRate(sampleRate: number | null) {
		playbackMachine.actions.updateSampleRate(sampleRate);
	},
	setBitDepth(bitDepth: number | null) {
		playbackMachine.actions.updateBitDepth(bitDepth);
	},
	setReplayGain(replayGain: number | null) {
		playbackMachine.actions.updateReplayGain(replayGain);
	}
};
