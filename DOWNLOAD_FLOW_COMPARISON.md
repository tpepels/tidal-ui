# Download Flow Comparison: Main vs Server-Side-Download-Queue

## Summary

The **main branch** only supports **browser-based downloads** where the client fetches audio and uploads it to the server.

The **server-side-download-queue branch** adds **background server-side downloads** while preserving the original browser-based flow.

---

## External API Usage Comparison

### Main Branch: Browser-Only Download Flow

**Actor: Browser**

1. **Fetch Track Metadata**
   - `GET {TIDAL_PROXY}/track/?id={trackId}&quality={quality}`
   - Example: `GET https://api.example.com/track/?id=12345&quality=LOSSLESS`
   - Response contains:
     - `originalTrackUrl` (pre-signed CloudFront URL) OR
     - `manifest` (base64-encoded DASH XML)

2. **Extract Stream URL**
   - If `originalTrackUrl` exists → use directly
   - Else parse `manifest`:
     - Decode base64
     - Extract `<BaseURL>` from DASH XML
     - URL format: `https://sp-ad-cf.audio.tidal.com/mediatracks/...?Policy=...&Signature=...&Key-Pair-Id=...`

3. **Download Audio**
   - **Direct fetch** (if not CORS-blocked):
     - `GET {CDN_URL}`
   - **OR through CORS proxy**:
     - `GET /api/proxy?url={encodeURIComponent(CDN_URL)}`
     - Proxy forwards request to CloudFront CDN

4. **Upload to Server**
   - `POST /api/download-track`
   - Body: `{ blob: "data:audio/flac;base64,...", trackId, quality, ... }`
   - Server saves the uploaded blob to disk

**External APIs contacted (from browser):**
- ✅ Tidal Proxy API (`/track/`)
- ✅ CloudFront CDN (direct or via `/api/proxy`)
- ✅ Server upload endpoint (`/api/download-track`)

---

### Current Branch: Browser + Server-Side Download Flow

#### Flow A: Browser-Based (UNCHANGED)

**Same as main branch** - browser downloads and uploads

#### Flow B: Server-Side Background Downloads (NEW)

**Actor: Background Worker (server-side)**

1. **Worker Processes Queue Job**
   - Reads job from Redis/memory queue
   - Job contains: `{ trackId, quality, albumTitle, artistName, ... }`

2. **Internal Download Endpoint**
   - Worker calls: `POST https://localhost:{PORT}/api/internal/download-track`
   - Body: `{ trackId, quality, albumTitle, artistName, ... }`
   - ⚠️ Uses `NODE_TLS_REJECT_UNAUTHORIZED=0` to accept self-signed cert

3. **Fetch Track Metadata (Server → Tidal Proxy)**
   - Internal endpoint calls: `GET {TIDAL_PROXY}/track/?id={trackId}&quality={quality}`
   - Example: `GET https://api.example.com/track/?id=12345&quality=LOSSLESS`
   - Response format: `{ version: "2.2", data: { trackId, manifest, originalTrackUrl?, ... } }`

4. **Extract Stream URL (Server-side)**
   - Check for `data.originalTrackUrl`, `data.url`, or `data.streamUrl`
   - Fallback: Parse `data.manifest`:
     - Decode base64
     - Extract `<BaseURL>` from DASH XML
     - **CRITICAL FIX**: Unescape XML entities (`&amp;` → `&`)
     - Result: `https://sp-ad-cf.audio.tidal.com/mediatracks/...?Policy=...&Signature=...&Key-Pair-Id=...`

5. **Download Audio via Internal Proxy (Server → Server)**
   - Internal endpoint calls: `GET https://localhost:{PORT}/api/proxy?url={encodeURIComponent(streamUrl)}`
   - Proxy endpoint forwards: `GET {CDN_URL}` to CloudFront

6. **Save Directly to Disk**
   - No upload step - audio buffer written directly to filesystem
   - Path: `/downloads/{artistName}/{albumTitle}/{trackNumber} {trackTitle}.flac`

**External APIs contacted (from server):**
- ✅ Tidal Proxy API (`/track/`)
- ✅ CloudFront CDN (via internal `/api/proxy` call)
- ❌ NO upload endpoint - saves directly

---

## Key Differences in External API Usage

| Aspect | Main Branch | Current Branch (Server-Side) |
|--------|-------------|------------------------------|
| **Tidal Proxy API** | Called from browser | Called from server |
| **CDN Access** | Browser → CDN (via `/api/proxy`) | Server → CDN (via internal `/api/proxy`) |
| **Upload Step** | Browser uploads blob to `/api/download-track` | ❌ No upload - direct write to disk |
| **Network Path** | Browser → Proxy → CDN → Browser → Server | Worker → Internal API → Proxy → CDN → Disk |
| **TLS Validation** | Standard browser cert validation | Uses `NODE_TLS_REJECT_UNAUTHORIZED=0` |
| **Signed URL Handling** | Browser handles CloudFront signatures | Server handles signatures + XML unescaping |

---

## Critical Issue Found (Current Branch)

### Problem: HTML Entity Encoding in CDN URLs

**Issue:** DASH XML manifests contain URLs with XML-encoded entities:
```xml
<BaseURL>https://cdn.tidal.com/file?Policy=XXX&amp;Signature=YYY&amp;Key-Pair-Id=ZZZ</BaseURL>
```

**Before Fix:**
- Server extracted URL directly: `...&amp;Signature=...&amp;Key-Pair-Id=...`
- Proxy forwarded malformed URL to CloudFront
- CloudFront rejected: `MissingKey` (couldn't parse `&amp;Key-Pair-Id`)

**After Fix:**
- Server unescapes XML entities: `&amp;` → `&`, `&quot;` → `"`
- Proxy forwards valid URL: `...&Signature=...&Key-Pair-Id=...`
- CloudFront accepts request ✅

---

## Network Topology

### Main Branch
```
Browser ─┬→ {TIDAL_PROXY}/track/?id=X ┐
         │                            ↓
         │                      (returns manifest)
         │                            ↓
         └→ /api/proxy?url={CDN} ───→ CloudFront CDN
                   ↓
            (audio blob)
                   ↓
         Browser uploads to /api/download-track
```

### Current Branch (Server-Side Path)
```
Background Worker
       ↓
/api/internal/download-track ─→ {TIDAL_PROXY}/track/?id=X
       ↓                                 ↓
  Parse manifest                   (returns manifest)
       ↓
  https://localhost/api/proxy?url={CDN} ─→ CloudFront CDN
       ↓                                         ↓
  Direct write to disk                    (audio stream)
```

---

## Conclusion

**Main Branch:** Browser-centric - all external API calls originate from the client

**Current Branch:** Hybrid model
- Browser path unchanged for backward compatibility
- Server-side path introduced for background/bulk downloads
- **Same external APIs** (Tidal Proxy + CloudFront CDN)
- **Different caller** (browser vs server)
- **No upload overhead** on server-side path (disk write directly)

**Critical Fix Applied:** XML entity unescaping for CloudFront signature validation
