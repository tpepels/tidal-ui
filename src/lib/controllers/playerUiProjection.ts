import { playerStore } from '$lib/stores/player';

export const playerUiProjection = {
	setDuration(duration: number) {
		playerStore.setDuration(duration);
	},
	setCurrentTime(time: number) {
		playerStore.setCurrentTime(time);
	},
	setVolume(volume: number) {
		playerStore.setVolume(volume);
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
