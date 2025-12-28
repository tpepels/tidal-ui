// Adapter to provide AudioPlayer-compatible API using the player store
import { get } from 'svelte/store';
import type { AudioQuality, PlayableTrack } from '../types';
import { playerStore } from './player';

type PlayerStoreState = {
	currentTrack: PlayableTrack | null;
	isPlaying: boolean;
	currentTime: number;
	duration: number;
	volume: number;
	quality: AudioQuality;
	isLoading: boolean;
	queue: PlayableTrack[];
	queueIndex: number;
	sampleRate: number | null;
	bitDepth: number | null;
	replayGain: number | null;
};

export const playerStoreAdapter = {
	subscribe(
		run: (value: PlayerStoreState) => void,
		invalidate?: (value?: PlayerStoreState) => void
	) {
		return playerStore.subscribe(run, invalidate);
	},

	loadTrack(track: PlayableTrack) {
		playerStore.setTrack(track);
	},

	play() {
		playerStore.play();
	},

	pause() {
		playerStore.pause();
	},

	stop() {
		playerStore.clearQueue();
	},

	next() {
		playerStore.next();
	},

	previous() {
		playerStore.previous();
	},

	togglePlay() {
		playerStore.togglePlay();
	},

	setCurrentTime(time: number) {
		playerStore.setCurrentTime(time);
	},

	setDuration(duration: number) {
		playerStore.setDuration(duration);
	},

	setVolume(volume: number) {
		playerStore.setVolume(volume);
	},

	addToQueue(track: PlayableTrack) {
		playerStore.enqueue(track);
	},

	removeFromQueue(index: number) {
		playerStore.removeFromQueue(index);
	},

	playAtIndex(index: number) {
		playerStore.playAtIndex(index);
	},

	clearQueue() {
		playerStore.clearQueue();
	},

	shuffleQueue() {
		playerStore.shuffleQueue();
	},

	setSampleRate(sampleRate: number | null) {
		playerStore.setSampleRate(sampleRate);
	},

	setBitDepth(bitDepth: number | null) {
		playerStore.setBitDepth(bitDepth);
	},

	setReplayGain(replayGain: number | null) {
		playerStore.setReplayGain(replayGain);
	},

	setLoading(loading: boolean) {
		playerStore.setLoading(loading);
	},

	get currentTrack() {
		return get(playerStore).currentTrack;
	},

	get isPlaying() {
		return get(playerStore).isPlaying;
	},

	get isLoading() {
		return get(playerStore).isLoading;
	},

	get currentTime() {
		return get(playerStore).currentTime;
	},

	get duration() {
		return get(playerStore).duration;
	},

	get volume() {
		return get(playerStore).volume;
	},

	get quality() {
		return get(playerStore).quality;
	},

	get queue() {
		return get(playerStore).queue;
	},

	get queueIndex() {
		return get(playerStore).queueIndex;
	},

	get sampleRate() {
		return get(playerStore).sampleRate;
	},

	get bitDepth() {
		return get(playerStore).bitDepth;
	},

	get replayGain() {
		return get(playerStore).replayGain;
	}
};
