# Tidal UI - API Proxy Status

## Current Issue

All configured Tidal proxy APIs are returning 404 errors, causing download and streaming failures.

## API Availability Test

Run `node test-apis.cjs` to test current proxy status.

## Finding Working Proxies

Since Tidal proxy services are community-maintained, they frequently go down or change.

To find working proxies:

1. Search for "working tidal api proxies 2024" or "tidal unofficial api"
2. Check Tidal community forums and Discord servers
3. Look for GitHub repositories with Tidal proxy implementations
4. Test potential APIs with the test script

## Updating Proxies

Edit `src/lib/config.ts` and update the `V2_API_TARGETS` array with working base URLs.

Example working proxy (if found):

```javascript
{
  name: 'working-proxy',
  baseUrl: 'https://working-proxy.example.com',
  weight: 50,
  requiresProxy: true,
  category: 'auto-only'
}
```

## Alternative Solutions

- Implement official Tidal API integration (requires authentication)
- Use different music service APIs
- Wait for community proxies to be restored

## Testing

After updating proxies, test with:

- `npm run test:e2e` (E2E tests)
- Manual testing of search, play, and download features
