import { describe, expect, it, vi } from 'vitest';
const playbackMachineActions = vi.hoisted(() => ({
	updateDuration: vi.fn(),
	updateTime: vi.fn(),
	updateVolume: vi.fn(),
	updateSampleRate: vi.fn(),
	updateBitDepth: vi.fn(),
	updateReplayGain: vi.fn()
}));

vi.mock('$lib/stores/playbackMachine.svelte', () => ({
	playbackMachine: {
		actions: playbackMachineActions
	}
}));

import { playerUiProjection } from './playerUiProjection';

describe('playerUiProjection', () => {
	it('forwards UI projection updates to playback machine', () => {
		playerUiProjection.setDuration(180);
		playerUiProjection.setCurrentTime(12);
		playerUiProjection.setVolume(0.5);
		playerUiProjection.setSampleRate(48000);
		playerUiProjection.setBitDepth(24);
		playerUiProjection.setReplayGain(-6);

		expect(playbackMachineActions.updateDuration).toHaveBeenCalledWith(180);
		expect(playbackMachineActions.updateTime).toHaveBeenCalledWith(12);
		expect(playbackMachineActions.updateVolume).toHaveBeenCalledWith(0.5);
		expect(playbackMachineActions.updateSampleRate).toHaveBeenCalledWith(48000);
		expect(playbackMachineActions.updateBitDepth).toHaveBeenCalledWith(24);
		expect(playbackMachineActions.updateReplayGain).toHaveBeenCalledWith(-6);
	});
});
