# Tidal Search API Specification

## Endpoints

- Tracks: `/search/?s=<query>`
- Artists: `/search/?a=<query>`
- Albums: `/search/?al=<query>`
- Playlists: `/search/?p=<query>` (not implemented)
- Videos: `/search/?v=<query>` (not implemented)

## Invalid Params

- Using `?q=<query>` for any search causes 400: "Provide one of s, a, al, v, or p"
- Always use specific params; never fallback to generic `?q=`

## Response Structure

```json
{
  "version": "...",
  "data": {
    "artists": [...],
    "albums": [...],
    "tracks": [...],
    "playlists": [...],
    "videos": [...],
    "genres": [...],
    "topHits": [...]
  }
}
```

## Parsing

- Extract from `response.data[key]` for the relevant array.
- Normalize to `{items: T[], limit, offset, totalNumberOfItems}`

## Error Handling

- 400: Return empty results, do NOT retry (prevents loops).
- Other errors: Throw as usual.

## Regression Prevention

- Add instrumentation counters for search/track calls.
- Log every 20th call with rate; stack trace on >100 calls.
- If items=0, log response keys to check structure changes.
- Test with known queries ("adele", "taylor") to ensure >0 results.</content>
  <parameter name="filePath">docs/SEARCH_API_SPEC.md
