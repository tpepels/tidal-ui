import { get } from 'svelte/store';
import type { Readable } from 'svelte/store';
import type { PlayableTrack } from '$lib/types';

type PlayerState = {
	currentTrack: PlayableTrack | null;
	duration: number;
	currentTime: number;
};

type MediaSessionController = {
	updatePositionState: () => void;
};

type AudioElementController = {
	handleTimeUpdate: () => void;
	handleDurationChange: () => void;
	handleProgress: () => void;
	handleEnded: () => void;
	updateBufferedPercent: () => void;
};

type ControllerOptions = {
	playerStore: Readable<PlayerState>;
	getAudioElement: () => HTMLMediaElement | null;
	onSetCurrentTime: (time: number) => void;
	onSetDuration: (duration: number) => void;
	onNextTrack: () => void;
	onBufferedPercentChange: (value: number) => void;
	onMaybePreloadNextTrack: (remainingSeconds: number) => void;
	mediaSessionController: MediaSessionController;
};

export const createAudioElementController = (options: ControllerOptions): AudioElementController => {
	const updateBufferedPercent = () => {
		const audioElement = options.getAudioElement();
		if (!audioElement) {
			options.onBufferedPercentChange(0);
			return;
		}

		const { duration, buffered, currentTime } = audioElement;
		if (!Number.isFinite(duration) || duration <= 0 || buffered.length === 0) {
			options.onBufferedPercentChange(0);
			return;
		}

		let bufferedEnd = 0;
		for (let i = 0; i < buffered.length; i += 1) {
			const start = buffered.start(i);
			const end = buffered.end(i);
			if (start <= currentTime && end >= currentTime) {
				bufferedEnd = end;
				break;
			}
			bufferedEnd = Math.max(bufferedEnd, end);
		}

		options.onBufferedPercentChange(Math.max(0, Math.min(100, (bufferedEnd / duration) * 100)));
	};

	const handleTimeUpdate = () => {
		const audioElement = options.getAudioElement();
		if (!audioElement) return;
		if (!Number.isFinite(audioElement.currentTime)) {
			return;
		}
		const storeState = get(options.playerStore);
		const duration = audioElement.duration;
		if (storeState.currentTime > 0 && audioElement.currentTime === 0) {
			return;
		}
		if (storeState.currentTrack && audioElement.currentTime === 0) {
			const durationInvalid = !Number.isFinite(duration) || duration <= 0;
			if (durationInvalid && storeState.currentTime > 0) {
				return;
			}
			if (durationInvalid && storeState.duration > 0) {
				return;
			}
		}
		options.onSetCurrentTime(audioElement.currentTime);
		updateBufferedPercent();
		const remaining = (storeState.duration ?? 0) - audioElement.currentTime;
		options.onMaybePreloadNextTrack(remaining);
		options.mediaSessionController.updatePositionState();
	};

	const handleDurationChange = () => {
		const audioElement = options.getAudioElement();
		if (!audioElement) return;
		options.onSetDuration(audioElement.duration);
		updateBufferedPercent();
		options.mediaSessionController.updatePositionState();
	};

	const handleProgress = () => {
		updateBufferedPercent();
	};

	const handleEnded = () => {
		options.onNextTrack();
		options.mediaSessionController.updatePositionState();
	};

	return {
		handleTimeUpdate,
		handleDurationChange,
		handleProgress,
		handleEnded,
		updateBufferedPercent
	};
};
