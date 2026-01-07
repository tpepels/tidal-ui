import { describe, expect, it, vi, beforeEach } from 'vitest';
import { playerStore } from '$lib/stores/player';
import type { PlayableTrack } from '$lib/types';

const makeTrack = (id: number): PlayableTrack =>
	({
		id,
		title: `Track ${id}`,
		duration: 180
	}) as PlayableTrack;

describe('playerStore queue transitions', () => {
	beforeEach(() => {
		playerStore.reset();
	});

	it('advances next and previous within bounds', () => {
		const tracks = [makeTrack(1), makeTrack(2), makeTrack(3)];
		playerStore.setQueue(tracks, 1);

		playerStore.next();
		let snapshot = playerStore.getSnapshot();
		expect(snapshot.queueIndex).toBe(2);
		expect(snapshot.currentTrack?.id).toBe(3);

		playerStore.previous();
		snapshot = playerStore.getSnapshot();
		expect(snapshot.queueIndex).toBe(1);
		expect(snapshot.currentTrack?.id).toBe(2);
	});

	it('pins the current track when shuffling', () => {
		const tracks = [makeTrack(10), makeTrack(11), makeTrack(12)];
		playerStore.setQueue(tracks, 1);
		const currentId = playerStore.getSnapshot().currentTrack?.id;
		const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.42);

		playerStore.shuffleQueue();

		const snapshot = playerStore.getSnapshot();
		expect(snapshot.queue.length).toBe(tracks.length);
		expect(snapshot.queueIndex).toBe(0);
		expect(snapshot.currentTrack?.id).toBe(currentId);
		expect(new Set(snapshot.queue.map((track) => track.id)).size).toBe(tracks.length);

		randomSpy.mockRestore();
	});
});
