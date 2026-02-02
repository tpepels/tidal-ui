import { describe, expect, it, vi } from 'vitest';
const playbackMachineActions = vi.hoisted(() => ({
	updateDuration: vi.fn(),
	updateTime: vi.fn(),
	updateVolume: vi.fn()
}));

vi.mock('$lib/stores/playbackMachine.svelte', () => ({
	playbackMachine: {
		actions: playbackMachineActions
	}
}));

import { playerUiProjection } from './playerUiProjection';
import { playerStore } from '$lib/stores/player';

describe('playerUiProjection', () => {
	it('forwards UI projection updates to playback machine and playerStore', () => {
		const setDuration = vi.spyOn(playerStore, 'setDuration');
		const setCurrentTime = vi.spyOn(playerStore, 'setCurrentTime');
		const setVolume = vi.spyOn(playerStore, 'setVolume');
		const setSampleRate = vi.spyOn(playerStore, 'setSampleRate');
		const setBitDepth = vi.spyOn(playerStore, 'setBitDepth');
		const setReplayGain = vi.spyOn(playerStore, 'setReplayGain');

		playerUiProjection.setDuration(180);
		playerUiProjection.setCurrentTime(12);
		playerUiProjection.setVolume(0.5);
		playerUiProjection.setSampleRate(48000);
		playerUiProjection.setBitDepth(24);
		playerUiProjection.setReplayGain(-6);

		expect(playbackMachineActions.updateDuration).toHaveBeenCalledWith(180);
		expect(playbackMachineActions.updateTime).toHaveBeenCalledWith(12);
		expect(playbackMachineActions.updateVolume).toHaveBeenCalledWith(0.5);
		expect(setDuration).not.toHaveBeenCalled();
		expect(setCurrentTime).not.toHaveBeenCalled();
		expect(setVolume).not.toHaveBeenCalled();
		expect(setSampleRate).toHaveBeenCalledWith(48000);
		expect(setBitDepth).toHaveBeenCalledWith(24);
		expect(setReplayGain).toHaveBeenCalledWith(-6);
	});
});
