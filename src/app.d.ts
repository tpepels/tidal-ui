// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	const umami:
		| {
				track: (event: string, data?: Record<string, unknown>) => void;
		  }
		| undefined;

	type RegionOption = import('$lib/stores/region').RegionOption;
	type PlaybackMachineSnapshot = {
		state: string;
		isPlaying: boolean;
		isLoading: boolean;
		currentTrackId: number | string | null;
		quality: import('$lib/types').AudioQuality;
		loadRequestId: number;
		queueIndex: number;
		queueLength: number;
	};

	interface Window {
		__tidalSetRegion?: (region: RegionOption) => void;
		__tidalSetDuration?: (duration: number) => void;
		__tidalSetCurrentTime?: (time: number) => void;
		__tidalSetQueue?: (tracks: import('$lib/types').PlayableTrack[], startIndex?: number) => void;
		__tidalShuffleQueue?: () => void;
		__tidalRehydratePlayback?: () => void;
		__tidalSetPlaybackQuality?: (quality: import('$lib/types').AudioQuality) => void;
		__tidalPlaybackMachineState?: () => PlaybackMachineSnapshot;
	}
}

declare module 'shaka-player/dist/shaka-player.compiled.js' {
	const shaka: {
		Player: new (mediaElement: HTMLMediaElement) => {
			load(uri: string): Promise<void>;
			unload(): Promise<void>;
			destroy(): Promise<void>;
			getNetworkingEngine?: () => {
				registerRequestFilter: (
					callback: (type: unknown, request: { method: string; uris: string[] }) => void
				) => void;
			};
		};
		polyfill?: {
			installAll?: () => void;
		};
	};
	export default shaka;
}

export {};
