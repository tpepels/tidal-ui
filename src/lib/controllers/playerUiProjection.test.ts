import { describe, expect, it, vi } from 'vitest';
import { playerUiProjection } from './playerUiProjection';
import { playerStore } from '$lib/stores/player';

describe('playerUiProjection', () => {
	it('forwards UI projection updates to playerStore', () => {
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

		expect(setDuration).toHaveBeenCalledWith(180);
		expect(setCurrentTime).toHaveBeenCalledWith(12);
		expect(setVolume).toHaveBeenCalledWith(0.5);
		expect(setSampleRate).toHaveBeenCalledWith(48000);
		expect(setBitDepth).toHaveBeenCalledWith(24);
		expect(setReplayGain).toHaveBeenCalledWith(-6);
	});
});
