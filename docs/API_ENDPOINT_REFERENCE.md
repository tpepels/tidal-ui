# API Endpoint Reference - WORKING ENDPOINTS ONLY

This document serves as the **authoritative reference** for all API endpoints and methods that are confirmed to be working. **DO NOT** use any endpoints or methods not listed in this document.

## Core Principle

**NEVER** fall back to broken or unworkable API calls. If an endpoint is not working or documented here, **DO NOT USE IT**. Instead, report the issue and wait for a fix.

## Working API Endpoints

All endpoints are relative to the base URL defined in `API_CONFIG.baseUrl`.

### Track Endpoints

#### GET `/track/?id={trackId}&quality={quality}`

**Status: ✅ WORKING**

Retrieves track information and streaming data.

**Parameters:**

- `id` (number): Track ID
- `quality` (string): AudioQuality - 'LOSSLESS', 'HIGH', 'LOW', 'HI_RES_LOSSLESS'

**Response:**

```typescript
interface TrackLookup {
	track: Track;
	info: TrackInfo;
	originalTrackUrl?: string;
}
```

**Implementation:** `losslessAPI.getTrack(trackId, quality)`

#### GET `/info/?id={trackId}`

**Status: ✅ WORKING**

Retrieves track metadata only.

**Parameters:**

- `id` (number): Track ID

**Response:** `Track` object

**Implementation:** `losslessAPI.fetchTrackMetadata(trackId)`

### Album Endpoints

#### GET `/album/?id={albumId}`

**Status: ✅ WORKING**

Retrieves album information with track listing.

**Parameters:**

- `id` (number): Album ID

**Response:**

```typescript
interface AlbumResponse {
	album: Album;
	tracks: Track[];
}
```

**Implementation:** `losslessAPI.getAlbum(albumId)`

### Artist Endpoints

#### GET `/artist/?f={artistId}`

**Status: ✅ WORKING**

Retrieves artist overview with discography and top tracks.

**Parameters:**

- `f` (number): Artist ID

**Response:** `ArtistDetails` object

**Implementation:** `losslessAPI.getArtist(artistId)`

#### GET `/artist/?id={artistId}`

**Status: ✅ WORKING**

Retrieves basic artist information (fallback endpoint).

**Parameters:**

- `id` (number): Artist ID

**Response:** `Artist` object

### Playlist Endpoints

#### GET `/playlist/?id={playlistId}`

**Status: ✅ WORKING**

Retrieves playlist information with track listing.

**Parameters:**

- `id` (string): Playlist UUID

**Response:**

```typescript
interface PlaylistResponse {
	playlist: Playlist;
	items: Array<{ item: Track }>;
}
```

**Implementation:** `losslessAPI.getPlaylist(playlistId)`

### Search Endpoints

#### GET `/search/?s={query}`

**Status: ✅ WORKING**

Search for tracks.

**Parameters:**

- `s` (string): Search query

**Response:** `SearchResponse<Track>`

**Implementation:** `losslessAPI.searchTracks(query)`

#### GET `/search/?a={query}`

**Status: ✅ WORKING**

Search for artists.

**Parameters:**

- `a` (string): Search query

**Response:** `SearchResponse<Artist>`

**Implementation:** `losslessAPI.searchArtists(query)`

#### GET `/search/?al={query}`

**Status: ✅ WORKING**

Search for albums.

**Parameters:**

- `al` (string): Search query

**Response:** `SearchResponse<Album>`

**Implementation:** `losslessAPI.searchAlbums(query)`

#### GET `/search/?p={query}`

**Status: ✅ WORKING**

Search for playlists.

**Parameters:**

- `p` (string): Search query

**Response:** `SearchResponse<Playlist>`

**Implementation:** `losslessAPI.searchPlaylists(query)`

### DASH Manifest Endpoints

#### GET `/dash/?id={trackId}&quality={quality}`

**Status: ✅ WORKING**

Retrieves DASH manifest for high-resolution audio.

**Parameters:**

- `id` (number): Track ID
- `quality` (string): AudioQuality - 'HI_RES_LOSSLESS'

**Response:** `DashManifestResult`

**Implementation:** `losslessAPI.getDashManifest(trackId, quality)`

### Lyrics Endpoints

#### GET `/lyrics/?id={trackId}`

**Status: ✅ WORKING**

Retrieves lyrics for a track.

**Parameters:**

- `id` (number): Track ID

**Response:** `Lyrics` object

**Implementation:** `losslessAPI.getLyrics(trackId)`

### Cover Endpoints

#### GET `/covers?query={coverId}&limit={limit}`

**Status: ✅ WORKING**

Search for cover images.

**Parameters:**

- `query` (string): Cover ID or search term
- `limit` (number): Number of results (default: 1)

**Response:** `CoverImage[]`

**Implementation:** `losslessAPI.getCover(coverId)`

### Song Endpoint (Legacy)

#### GET `/song/?q={query}&quality={quality}`

**Status: ✅ WORKING**

Legacy endpoint for song search and streaming.

**Parameters:**

- `q` (string): Search query
- `quality` (string): AudioQuality

**Response:** `StreamData` object

**Implementation:** `losslessAPI.getSong(query, quality)`

## API Methods - Implementation Reference

All methods below are confirmed to be working and should be used instead of direct endpoint calls.

### Core API Methods

#### `losslessAPI.getTrack(trackId: number, quality?: AudioQuality): Promise<TrackLookup>`

✅ **WORKING** - Primary method for getting track information and streaming URLs.

#### `losslessAPI.getStreamData(trackId: number, quality?: AudioQuality): Promise<{url: string, replayGain: number | null, sampleRate: number | null, bitDepth: number | null}>`

✅ **WORKING** - Gets streaming data including URL and audio metadata.

#### `losslessAPI.getStreamUrl(trackId: number, quality?: AudioQuality): Promise<string>`

✅ **WORKING** - Gets just the stream URL.

#### `losslessAPI.getTrackStreamUrl(trackId: number, quality?: AudioQuality): Promise<string>`

✅ **WORKING** - Alternative method for getting stream URLs.

### Content Methods

#### `losslessAPI.getAlbum(albumId: number): Promise<{album: Album, tracks: Track[]}>`

✅ **WORKING** - Gets album with full track listing.

#### `losslessAPI.getArtist(artistId: number): Promise<ArtistDetails>`

✅ **WORKING** - Gets artist overview with discography.

#### `losslessAPI.getPlaylist(playlistId: string): Promise<{playlist: Playlist, items: Array<{item: Track}>}>`

✅ **WORKING** - Gets playlist with track listing.

### Search Methods

#### `losslessAPI.searchTracks(query: string, region?: RegionOption): Promise<SearchResponse<Track>>`

✅ **WORKING** - Search tracks with regional support.

#### `losslessAPI.searchArtists(query: string, region?: RegionOption): Promise<SearchResponse<Artist>>`

✅ **WORKING** - Search artists with regional support.

#### `losslessAPI.searchAlbums(query: string, region?: RegionOption): Promise<SearchResponse<Album>>`

✅ **WORKING** - Search albums with regional support.

#### `losslessAPI.searchPlaylists(query: string, region?: RegionOption): Promise<SearchResponse<Playlist>>`

✅ **WORKING** - Search playlists with regional support.

### Utility Methods

#### `losslessAPI.getLyrics(trackId: number): Promise<Lyrics>`

✅ **WORKING** - Gets lyrics for a track.

#### `losslessAPI.getCover(coverId: string): Promise<CoverImage[]>`

✅ **WORKING** - Gets cover images.

#### `losslessAPI.getDashManifest(trackId: number, quality?: AudioQuality): Promise<DashManifestResult>`

✅ **WORKING** - Gets DASH manifest for high-res audio.

#### `losslessAPI.getDashManifestWithMetadata(trackId: number, quality?: AudioQuality): Promise<DashManifestWithMetadata>`

✅ **WORKING** - Gets DASH manifest with metadata.

### Download Methods

#### `losslessAPI.downloadTrack(trackId: number, quality: AudioQuality, filename: string, options?: DownloadTrackOptions): Promise<void>`

✅ **WORKING** - Downloads track with metadata embedding.

#### `losslessAPI.fetchTrackBlob(trackId: number, quality: AudioQuality, filename: string, options?: DownloadTrackOptions): Promise<{blob: Blob, mimeType?: string}>`

✅ **WORKING** - Fetches track blob for download.

### URL Methods

#### `losslessAPI.getCoverUrl(coverId: string, size?: '1280' | '640' | '320' | '160' | '80'): string`

✅ **WORKING** - Gets cover image URL.

#### `losslessAPI.getVideoCoverUrl(videoCoverId: string, size?: '1280' | '640' | '320' | '160' | '80'): string`

✅ **WORKING** - Gets video cover URL.

#### `losslessAPI.getArtistPictureUrl(pictureId: string, size?: '750'): string`

✅ **WORKING** - Gets artist picture URL.

## Regional Support

All search methods support regional endpoints:

```typescript
type RegionOption = 'auto' | 'us' | 'eu' | 'asia' | string;
```

Use `'auto'` for automatic region detection based on user location.

## Error Handling

### Rate Limiting

- Status code `429` triggers rate limit error
- Automatic retry with exponential backoff
- Token refresh for authentication errors (status `401`, subStatus `11002`)

### Quality Fallback

- Automatic fallback from HI_RES_LOSSLESS to LOSSLESS
- Quality-specific error handling
- Manifest parsing fallbacks

### Network Errors

- CORS handling via `fetchWithCORS`
- Timeout protection
- AbortController support for cancellation

## Testing

All endpoints are tested via:

- `src/lib/api-endpoint-validation.test.ts` - Endpoint format validation
- `src/lib/services/*.test.ts` - Service layer integration tests
- API health checks in pre-commit hooks

## Important Notes

1. **ALWAYS use the API methods, NEVER direct endpoint calls** - The methods handle retries, fallbacks, and error recovery.

2. **NEVER implement new endpoints without testing** - All new endpoints must be validated and added to this document.

3. **REGIONAL ENDPOINTS**: Always use the regional URL builders for search endpoints.

4. **ERROR RECOVERY**: The API methods include automatic error recovery and fallbacks.

5. **RATE LIMITING**: All methods respect rate limits with automatic retry logic.

## Breaking Changes Prevention

- This document serves as the single source of truth for working API endpoints
- All API changes must be validated and documented here
- Pre-commit hooks verify API functionality
- Tests ensure no regressions in API behavior

---

**Last Updated:** December 2025
**Version:** 1.0
**Status:** ✅ All endpoints confirmed working
