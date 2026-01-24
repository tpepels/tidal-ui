type NetworkEngine = {
	registerRequestFilter: (callback: (type: unknown, request: { method: string; uris: string[] }) => void) => void;
};

class MockShakaPlayer {
	async load(): Promise<void> {}
	async unload(): Promise<void> {}
	async destroy(): Promise<void> {}
	async attach(): Promise<void> {}
	getNetworkingEngine(): NetworkEngine {
		return {
			registerRequestFilter: () => {}
		};
	}
}

const shaka = {
	Player: MockShakaPlayer
};

export default shaka;
