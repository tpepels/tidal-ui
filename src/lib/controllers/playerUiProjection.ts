import { playerStore } from '$lib/stores/player';
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
		playerStore.setSampleRate(sampleRate);
	},
	setBitDepth(bitDepth: number | null) {
		playerStore.setBitDepth(bitDepth);
	},
	setReplayGain(replayGain: number | null) {
		playerStore.setReplayGain(replayGain);
	}
};
