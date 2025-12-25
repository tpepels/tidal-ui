// Main API exports - unified interface for all Tidal API functionality
export { LosslessAPI } from './client';
export { SearchAPI } from './search';
export { ContentAPI } from './content';
export { StreamsAPI } from './streams';
// export { MetadataAPI } from './metadata'; // TODO: Implement complex download logic

// Re-export types for convenience
export type {
	TrackDownloadProgress,
	DashManifestResult,
	DashManifestWithMetadata,
	DownloadTrackOptions
} from './client';
