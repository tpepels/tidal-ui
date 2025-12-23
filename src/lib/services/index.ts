// Service exports
export { TidalApiClient } from './tidal-api.client';
export { SearchService } from './search.service';
export { PlaybackService } from './playback.service';
export { ContentService } from './content.service';
export { BaseApiService, type SearchResponse, type ApiResponse } from './base-api.service';

// Re-export types for convenience
export type { Track, Album, Artist, Playlist, AudioQuality } from '../types';
export type { RegionOption } from '../stores/region';
