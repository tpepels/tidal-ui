# Tidal UI Architecture

## Table of Contents

1. [Overview](#overview)
2. [Architectural Principles](#architectural-principles)
3. [Service Layer Pattern](#service-layer-pattern)
4. [Error Handling Pattern](#error-handling-pattern)
5. [State Management](#state-management)
6. [Orchestrator Layer](#orchestrator-layer)
7. [Data Flow](#data-flow)
8. [Testing Strategy](#testing-strategy)

---

## Overview

This application follows a **layered architecture** with clear separation of concerns:

```
┌─────────────────────────────────────────┐
│         Components (Presentation)        │  ← Svelte components, UI logic
├─────────────────────────────────────────┤
│       Stores (State Management)          │  ← Reactive state, adapters
├─────────────────────────────────────────┤
│       Services (Business Logic)          │  ← Pure functions, domain logic
├─────────────────────────────────────────┤
│       API/Utils (Infrastructure)         │  ← HTTP, external integrations
└─────────────────────────────────────────┘
```

**Key Benefits:**
- **Testability**: Services are pure functions testable in isolation
- **Maintainability**: Clear boundaries between layers
- **Type Safety**: Structured errors and discriminated unions
- **Performance**: Optimized state updates and batched operations

---

## Architectural Principles

### 1. Unidirectional Data Flow

**Rule:** Data flows in one direction through the architecture.

```
User Action → Component → Service → (Callbacks) → Component → Store → UI Update
```

**Anti-pattern (Bidirectional):**
```typescript
// ❌ DON'T: Service calling store directly
export async function downloadTrack(track: Track) {
  downloadUiStore.updateProgress(taskId, progress);  // Circular dependency!
}
```

**Correct (Unidirectional):**
```typescript
// ✅ DO: Service accepts callbacks
export async function downloadTrack(
  track: Track,
  options?: { callbacks?: { onProgress?: (event) => void } }
) {
  options?.callbacks?.onProgress?.({ receivedBytes, totalBytes });
}

// Component wires callbacks to store
const result = await downloadTrack(track, {
  callbacks: {
    onProgress: (event) => downloadUiStore.updateProgress(taskId, event)
  }
});
```

### 2. Pure Service Functions

**Rule:** Services must be **pure** - no side effects, no global state access (except read-only config).

**Benefits:**
- Easy to test (no mocking required)
- Predictable behavior
- Composable and reusable

**Example:**
```typescript
// ✅ Pure service
export async function convertStreamingUrl(url: string): Promise<ConversionResult> {
  // Only depends on parameters, returns structured result
  if (!url.trim()) {
    return { success: false, error: { code: 'INVALID_URL', ... } };
  }

  try {
    const data = await externalAPI.convert(url);
    return { success: true, data };
  } catch (error) {
    return { success: false, error: classifyError(error) };
  }
}
```

### 3. Structured Error Handling

**Rule:** Never throw or return string errors. Always use discriminated unions.

See [Error Handling Pattern](#error-handling-pattern) for details.

### 4. Explicit State Invariants

**Rule:** State stores must validate invariants on every update.

See [State Management](#state-management) for details.

---

## Service Layer Pattern

### Directory Structure

```
src/lib/services/
├── playback/
│   ├── index.ts                    # Public exports
│   ├── downloadService.ts          # Download orchestration
│   ├── trackConversionService.ts   # Track conversion logic
│   └── playbackControlService.ts   # Playback operations
└── search/
    ├── index.ts                    # Public exports
    ├── searchService.ts            # Search execution
    ├── streamingUrlConversionService.ts
    └── playlistConversionService.ts
```

### Service Signature Pattern

**Every service function follows this pattern:**

```typescript
// 1. Define structured error types
export type ServiceError =
  | { code: 'ERROR_TYPE_1'; retry: boolean; message: string; context?: ... }
  | { code: 'ERROR_TYPE_2'; retry: boolean; message: string; context?: ... };

// 2. Define result type (discriminated union)
export type ServiceResult =
  | { success: true; data: YourDataType }
  | { success: false; error: ServiceError };

// 3. Define options interface (if needed)
export interface ServiceOptions {
  // Configuration parameters
  timeout?: number;

  // Callbacks for side effects
  callbacks?: {
    onProgress?: (progress: ProgressData) => void;
    onComplete?: (result: YourDataType) => void;
    onError?: (error: ServiceError) => void;
  };
}

// 4. Service function signature
export async function yourService(
  requiredParams: string,
  options?: ServiceOptions
): Promise<ServiceResult> {
  // Input validation
  if (!requiredParams) {
    return {
      success: false,
      error: { code: 'INVALID_INPUT', retry: false, message: '...' }
    };
  }

  try {
    // Business logic
    const result = await doWork(requiredParams);

    // Notify via callbacks (don't update stores!)
    options?.callbacks?.onComplete?.(result);

    return { success: true, data: result };
  } catch (error) {
    const classifiedError = classifyError(error);
    options?.callbacks?.onError?.(classifiedError);
    return { success: false, error: classifiedError };
  }
}
```

### Error Classification Pattern

**Every service should have an error classifier:**

```typescript
function classifyYourError(error: unknown): ServiceError {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    // Network errors (retryable)
    if (message.includes('network') || message.includes('fetch')) {
      return {
        code: 'NETWORK_ERROR',
        retry: true,
        message: error.message,
        originalError: error
      };
    }

    // Business errors (not retryable)
    if (message.includes('not found')) {
      return {
        code: 'NOT_FOUND',
        retry: false,
        message: error.message
      };
    }

    // Unknown errors
    return {
      code: 'UNKNOWN_ERROR',
      retry: false,
      message: error.message,
      originalError: error
    };
  }

  return {
    code: 'UNKNOWN_ERROR',
    retry: false,
    message: typeof error === 'string' ? error : 'Unknown error',
    originalError: error
  };
}
```

---

## Error Handling Pattern

### Why Structured Errors?

**Problems with string errors:**
```typescript
// ❌ String errors - no type safety
try {
  await searchTracks(query);
} catch (error) {
  // What kind of error? Network? Validation? API?
  // Should we retry? Show to user? Log?
  // No way to know!
  console.error(error);
}
```

**Solution: Discriminated unions:**
```typescript
// ✅ Structured errors - full type safety
const result = await searchTracks(query);

if (!result.success) {
  switch (result.error.code) {
    case 'NETWORK_ERROR':
      // Retry logic
      if (result.error.retry) {
        toast.info('Retrying...', { action: { label: 'Retry', onClick: retry } });
      }
      break;

    case 'INVALID_QUERY':
      // User feedback
      toast.error(result.error.message);
      break;

    case 'API_ERROR':
      // Log for debugging
      console.error('API error:', result.error.statusCode, result.error.message);
      break;
  }
}
```

### Error Type Structure

**Every error type must have:**

1. **`code`**: Unique string literal for discriminated union
2. **`retry`**: Boolean indicating if operation should be retried
3. **`message`**: Human-readable error message
4. **Optional context**: Additional data specific to error type

**Example from searchService.ts:**
```typescript
export type SearchError =
  | { code: 'NETWORK_ERROR'; retry: true; message: string; originalError?: unknown }
  | { code: 'INVALID_QUERY'; retry: false; message: string }
  | { code: 'API_ERROR'; retry: true; message: string; statusCode?: number }
  | { code: 'TIMEOUT'; retry: true; message: string }
  | { code: 'UNKNOWN_ERROR'; retry: false; message: string; originalError?: unknown };
```

### Result Type Pattern

**All async services return `Result<T, E>`:**

```typescript
type Result<T, E> =
  | { success: true; data: T }
  | { success: false; error: E };
```

**Benefits:**
- No thrown exceptions to catch
- Errors are explicitly part of the return type
- TypeScript enforces error handling
- Composable (can chain results)

### Component Usage Pattern

```typescript
// In Svelte component
async function handleSubmit() {
  const result = await yourService(input, {
    callbacks: {
      onProgress: (progress) => {
        // Update UI during operation
        loadingMessage = `Processing ${progress.loaded}/${progress.total}...`;
      }
    }
  });

  if (result.success) {
    // Handle success
    data = result.data;
    toast.success('Operation completed!');
  } else {
    // Handle error with full type information
    if (result.error.retry) {
      // Show retry UI
      showRetryButton = true;
    } else {
      // Show permanent error
      toast.error(result.error.message);
    }

    // Log for debugging
    console.error(`[Component] Error ${result.error.code}:`, result.error);
  }
}
```

---

## State Management

### Store Architecture

**We use Svelte stores with adapter pattern:**

```
┌──────────────────────────────┐
│  Component (imports store)    │
└──────────┬───────────────────┘
           │
┌──────────▼───────────────────┐
│  Store Adapter (public API)   │  ← searchStoreAdapter, etc.
│  - Actions (commit, search)   │
│  - Derived stores             │
└──────────┬───────────────────┘
           │
┌──────────▼───────────────────┐
│  Base Store (private state)   │  ← Writable store
│  + Invariant Validation       │
└──────────────────────────────┘
```

### Invariant Enforcement Pattern

**Example from searchStoreAdapter.ts:**

```typescript
const enforceInvariants = (state: SearchStoreState) => {
  // INVARIANT 1: Loading state consistency
  validateInvariant(
    !state.isLoading || hasAnyTabLoading,
    'Search is loading but no tab is marked as loading',
    { tabLoading: state.tabLoading }
  );

  // INVARIANT 2: Error state excludes loading state
  validateInvariant(
    !state.error || !state.isLoading,
    'Search has error but is still marked as loading',
    { error: state.error, isLoading: state.isLoading }
  );

  // INVARIANT 3: Only the active tab can be loading
  validateInvariant(
    loadingTabs.length === 0 || loadingTabs[0] === state.activeTab,
    'Non-active tab is marked as loading',
    { activeTab: state.activeTab, loadingTabs }
  );

  // ... more invariants

  return state;
};

// Applied on every update
const updateSearchStore = (updater: (state) => state) => {
  searchStoreBase.update((state) => enforceInvariants(updater(state)));
};
```

### State Transition Validation

**The `commit()` action validates and auto-corrects transitions:**

```typescript
commit(payload: SearchCommitPayload) {
  updateSearchStore((store) => {
    // STATE TRANSITION VALIDATION

    // Rule 1: Error state forces loading = false
    if (nextError && nextIsLoading) {
      console.warn('[SearchStore] Cannot commit error while loading. Clearing loading state.');
    }

    // Rule 2: New results clear error state
    if (payload.results !== undefined && nextError) {
      console.warn('[SearchStore] Clearing error state when new results provided.');
    }

    return {
      ...store,
      isLoading: nextError ? false : nextIsLoading,  // Auto-correct
      error: payload.results ? null : nextError,      // Auto-correct
      // ... other fields
    };
  });
}
```

### Invariant Utility

**Located at `src/lib/core/invariants.ts`:**

```typescript
export function validateInvariant(
  condition: boolean,
  message: string,
  context?: Record<string, unknown>
): void {
  if (!condition) {
    console.error(`[Invariant Violation] ${message}`, context);

    if (import.meta.env.DEV) {
      throw new Error(`Invariant violation: ${message}`);
    }
  }
}
```

**Usage:**
- **Development**: Throws exception immediately (fail fast)
- **Production**: Logs error with context (graceful degradation)

---

## Orchestrator Layer

### What are Orchestrators?

Orchestrators coordinate multi-service workflows and manage complex state machines. They sit **between components and services**, providing a higher-level API that combines multiple services and store interactions into cohesive workflows.

### Orchestrator vs Service vs Controller

| Layer | Purpose | Store Access | Examples |
| ----- | ------- | ------------ | -------- |
| **Service** | Pure business logic, no side effects | ❌ None (uses callbacks) | searchService, downloadService |
| **Orchestrator** | Workflow coordination, state machines | ✅ Direct store calls | searchOrchestrator, playlistOrchestrator |
| **Controller** | Infrastructure coordination | ✅ Direct (for lifecycle) | audioElementController, mediaSessionController |
| **Component** | Presentation, UI logic | ✅ Via stores/orchestrators | SearchInterface.svelte, AudioPlayer.svelte |

**Key Distinction:**

- **Services** are pure and reusable - they can be called from anywhere
- **Orchestrators** manage workflows - they coordinate services + stores for specific use cases
- **Controllers** manage infrastructure - audio elements, Media Session API, etc.

### Example: Download Orchestrator

The download orchestrator handles the complete download workflow:

```typescript
// src/lib/orchestrators/downloadOrchestrator.ts
export class DownloadOrchestrator {
  async downloadTrack(
    track: PlayableTrack,
    options?: DownloadOrchestratorOptions
  ): Promise<DownloadOrchestratorResult> {
    // Step 1: Auto-convert Songlink track if needed
    if (isSonglinkTrack(track) && options?.autoConvertSonglink) {
      const result = await convertSonglinkTrackToTidal(track);
      if (!result.success) {
        return { success: false, error: { code: 'CONVERSION_FAILED', ... } };
      }
      track = result.track;
    }

    // Step 2: Create download task in store
    const { taskId, controller } = downloadUiStore.beginTrackDownload(track, filename);

    // Step 3: Execute download with callbacks
    const result = await downloadService(track, {
      callbacks: {
        onProgress: (event) => downloadUiStore.updateTrackProgress(taskId, event),
        onComplete: () => downloadUiStore.completeTrackDownload(taskId),
        onError: (error) => downloadUiStore.errorTrackDownload(taskId, error.message)
      }
    });

    return result;
  }
}
```

**Orchestrator Benefits:**

1. **Component Simplification** - Components call one function instead of coordinating multiple services
2. **Workflow Centralization** - Business logic in one place instead of scattered across components
3. **Testability** - Can test orchestration logic independently of UI
4. **Reusability** - Same workflow can be used from different components

### Example: Search Orchestrator

The search orchestrator detects URL types and routes to appropriate workflows:

```typescript
// src/lib/orchestrators/searchOrchestrator.ts
export class SearchOrchestrator {
  async search(query: string, tab: SearchTab, options?: SearchOrchestratorOptions) {
    const urlType = this.detectUrlType(query);

    switch (urlType) {
      case 'spotify-playlist':
        return this.handlePlaylistWorkflow(query);

      case 'streaming':
        return this.handleStreamingUrlWorkflow(query, options);

      case 'none':
      default:
        return this.handleStandardSearchWorkflow(query, tab, options);
    }
  }

  private async handleStreamingUrlWorkflow(url: string) {
    // Update store to loading state
    searchStoreActions.commit({ isLoading: true, error: null });

    // Convert URL
    const result = await convertStreamingUrl(url);

    if (result.success && result.data.type === 'track') {
      // Play track immediately
      playerStore.setTrack(result.data.track);
      playerStore.play();
      searchStoreActions.commit({ query: '', isLoading: false });
    }

    return result;
  }
}
```

**Workflow Handled:**

- URL type detection (Spotify playlist vs streaming URL vs search query)
- Delegation to playlist orchestrator for Spotify playlists
- Streaming URL conversion with appropriate result handling (play track, show album, etc.)
- Standard search with error handling and toast notifications

### Example: Playlist Orchestrator

The playlist orchestrator manages the complex 8-phase state machine for playlist conversion:

```typescript
// src/lib/orchestrators/playlistOrchestrator.ts
export class PlaylistOrchestrator {
  async convertPlaylist(url: string, options?: PlaylistConversionOptions) {
    // Phase 1: Initialize
    if (options?.updateSearchStore) {
      this.initializeStoreState(url);
    }

    // Phase 2-7: Progressive conversion
    const result = await convertSpotifyPlaylistToTracks(url, {
      onProgress: (progress) => {
        if (options?.updateSearchStore) {
          this.updateStoreProgress(progress);
        }
      },
      progressBatchSize: 5,
      progressThrottleMs: 100
    });

    // Phase 8: Finalize
    if (options?.updateSearchStore) {
      this.finalizeStoreState(result, options.clearQueryOnComplete);
    }

    // Auto-clear after delay
    if (options?.autoClearAfterMs > 0) {
      this.scheduleAutoClear(options.autoClearAfterMs);
    }

    return { success: true, tracks: result.successful, ... };
  }

  // AsyncGenerator for fine-grained control
  async *convertPlaylistProgressive(url: string) {
    yield { phase: 'initializing', loaded: 0, total: 0, ... };

    const result = await convertSpotifyPlaylistToTracks(url, {
      onProgress: (progress) => progressUpdates.push(progress)
    });

    yield { phase: 'completed', loaded: result.total, total: result.total, ... };
  }
}
```

**Features:**

- AsyncGenerator pattern for progressive updates
- Automatic store state management
- Auto-clear timer functionality
- Cancellation support with AbortController

### Orchestrator Guidelines

**When to Create an Orchestrator:**

1. Workflow involves 3+ service calls
2. Complex state machine (multiple phases)
3. Needs to coordinate multiple stores
4. Same workflow used from multiple components
5. Component has 100+ lines of orchestration logic

**When NOT to Create an Orchestrator:**

1. Simple single-service call (just call service from component)
2. Infrastructure coordination (use Controller instead)
3. Pure UI state management (keep in component)

**Design Principles:**

1. ✅ **DO**: Call stores directly (orchestrators are coordination layer)
2. ✅ **DO**: Return `Result<T, E>` types like services
3. ✅ **DO**: Accept options with callbacks for extensibility
4. ✅ **DO**: Export singleton instances
5. ❌ **DON'T**: Import other orchestrators (except delegation pattern)
6. ❌ **DON'T**: Have circular dependencies
7. ❌ **DON'T**: Throw exceptions (use Result types)

### Current Orchestrators

**`downloadOrchestrator`**

- Auto-converts Songlink tracks before download
- Manages download UI task lifecycle
- Handles retry functionality
- Notification modes (alert/toast/silent)

**`searchOrchestrator`**

- Detects URL type and routes workflows
- Handles standard search
- Converts streaming URLs (Spotify/Apple Music/YouTube)
- Delegates playlist conversion to playlistOrchestrator

**`playlistOrchestrator`**

- Converts Spotify playlists to TIDAL tracks
- Progressive loading with batched updates
- 8-phase state machine
- Auto-clear functionality
- AsyncGenerator API for fine-grained control

---

## Data Flow

### Complete Flow Example: Search Operation

```
1. User types in search box
   ↓
2. Component calls service
   const result = await executeTabSearch(query, tab);
   ↓
3. Service executes business logic
   - Validates input
   - Deduplicates in-flight requests
   - Calls API with retry logic
   - Classifies errors
   ↓
4. Service returns structured result
   return { success: true, results } OR { success: false, error }
   ↓
5. Component checks result
   if (result.success) { ... } else { ... }
   ↓
6. Component updates store
   searchStoreActions.commit({ results: result.results })
   ↓
7. Store validates invariants
   enforceInvariants(newState)
   ↓
8. Store notifies subscribers
   Svelte reactivity updates UI
```

### Download Flow with Callbacks

```
1. User clicks download button
   ↓
2. Component creates download task in store
   const { taskId, controller } = downloadUiStore.beginTrackDownload(track, filename);
   ↓
3. Component calls service with callbacks
   await downloadTrack(track, {
     signal: controller.signal,
     callbacks: {
       onProgress: (event) => downloadUiStore.updateTrackProgress(taskId, event),
       onComplete: (filename) => downloadUiStore.completeTrackDownload(taskId),
       onError: (error) => downloadUiStore.errorTrackDownload(taskId, error.message)
     }
   });
   ↓
4. Service executes download
   - Calls API
   - Invokes callbacks during progress
   - Returns structured result
   ↓
5. Store updates trigger UI changes
   Progress bar, status messages, completion state
```

**Key Points:**
- Service doesn't know about stores
- Component orchestrates the flow
- Store updates are explicit and traceable

---

## Testing Strategy

### Service Testing (Unit Tests)

**Services are pure functions - easy to test:**

```typescript
import { describe, it, expect } from 'vitest';
import { executeTabSearch } from './searchService';

describe('searchService', () => {
  it('should return error for empty query', async () => {
    const result = await executeTabSearch('', 'tracks');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('INVALID_QUERY');
      expect(result.error.retry).toBe(false);
    }
  });

  it('should classify network errors correctly', async () => {
    // Mock network failure
    mockAPI.searchTracks.mockRejectedValue(new Error('Network error'));

    const result = await executeTabSearch('test', 'tracks');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('NETWORK_ERROR');
      expect(result.error.retry).toBe(true);  // Should be retryable
    }
  });
});
```

### Store Testing (Integration Tests)

**Test invariant enforcement:**

```typescript
describe('searchStoreAdapter invariants', () => {
  it('should auto-correct error + loading state', () => {
    searchStoreActions.commit({
      isLoading: true,
      error: 'Some error'  // Invalid combination!
    });

    const state = get(searchStore);

    // Store should auto-correct: error forces loading = false
    expect(state.isLoading).toBe(false);
    expect(state.error).toBe('Some error');
  });

  it('should throw in dev mode for invalid state', () => {
    // Simulate development mode
    import.meta.env.DEV = true;

    expect(() => {
      // Try to create impossible state
      searchStoreActions.commit({
        isLoading: false,
        tabLoading: { tracks: true, albums: false, artists: false, playlists: false }
      });
    }).toThrow('Invariant violation');
  });
});
```

### Component Testing (E2E Tests)

**Test the complete flow:**

```typescript
describe('Search component', () => {
  it('should handle network errors gracefully', async () => {
    mockAPI.searchTracks.mockRejectedValue(new Error('Network error'));

    await userEvent.type(screen.getByRole('searchbox'), 'test query');
    await userEvent.click(screen.getByRole('button', { name: 'Search' }));

    // Should show error message
    expect(await screen.findByText(/network error/i)).toBeInTheDocument();

    // Should show retry button (because error.retry = true)
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
```

---

## Performance Optimizations

### 1. Progress Batching

**Problem:** O(n²) UI updates for playlist conversion

**Solution:** Batch progress callbacks

```typescript
// From playlistConversionService.ts
const reportProgress = (loaded: number, force: boolean = false) => {
  const shouldBatch = loaded % batchSize !== 0;        // Every 5 tracks
  const shouldThrottle = now - lastProgressTime < 100; // Min 100ms

  if (force || (!shouldBatch && !shouldThrottle)) {
    onProgress({ loaded, total, successful: [...successful] });  // Only copy when reporting
  }
};
```

**Result:** 5x performance improvement for 100-track playlists

### 2. Request Deduplication

**Problem:** Multiple concurrent searches for same query

**Solution:** In-flight request cache

```typescript
// From searchService.ts
const inFlightSearches = new Map<string, Promise<SearchResult>>();

const searchKey = `${tab}:${query.toLowerCase()}`;
let pending = inFlightSearches.get(searchKey);

if (!pending) {
  pending = executeSearch(query);
  inFlightSearches.set(searchKey, pending);
}

return await pending;
```

### 3. Invariant Checks

**Performance consideration:** Invariant checks run on every store update

**Mitigation:**
- Only enabled in development (throw exceptions)
- Production only logs (no exceptions)
- Fast checks (simple boolean conditions)

```typescript
if (import.meta.env.DEV) {
  throw new Error(`Invariant violation: ${message}`);  // Dev only
} else {
  console.error(`[Invariant Violation] ${message}`);   // Prod fallback
}
```

---

## Migration Guide

### Converting Old Code to New Pattern

**Old pattern (throws exceptions):**
```typescript
async function oldSearch(query: string): Promise<Track[]> {
  if (!query) throw new Error('Invalid query');
  return await api.search(query);
}

// Usage
try {
  const tracks = await oldSearch(query);
  updateUI(tracks);
} catch (error) {
  showError(error.message);  // No type safety!
}
```

**New pattern (structured results):**
```typescript
async function newSearch(query: string): Promise<SearchResult> {
  if (!query) {
    return {
      success: false,
      error: { code: 'INVALID_QUERY', retry: false, message: 'Query is required' }
    };
  }

  try {
    const tracks = await api.search(query);
    return { success: true, data: tracks };
  } catch (error) {
    return { success: false, error: classifyError(error) };
  }
}

// Usage
const result = await newSearch(query);

if (result.success) {
  updateUI(result.data);  // Type-safe!
} else {
  if (result.error.retry) {
    showRetryButton();
  }
  showError(result.error.message);  // Type-safe error handling
}
```

---

## Best Practices

### DO ✅

- Return `Result<T, E>` from all async services
- Use discriminated unions for errors
- Include `retry: boolean` in every error type
- Validate invariants in stores
- Use callbacks for side effects in services
- Keep services pure (no global state mutations)
- Document error codes and when they occur

### DON'T ❌

- Throw exceptions from services (use Result types)
- Return string errors (use structured error objects)
- Call stores directly from services (use callbacks)
- Create circular dependencies (services ↔ stores)
- Skip invariant validation in stores
- Mix business logic with presentation logic
- Use `any` or `unknown` for errors (use discriminated unions)

---

## Future Improvements

### 1. Workflow Orchestrators

**Goal:** Extract component orchestration into dedicated orchestrator layer

**Benefits:**
- Components become pure presentation
- Business workflows centralized
- Easier to test complex flows

**Example structure:**
```
src/lib/orchestrators/
├── searchOrchestrator.ts      # Coordinates search + filters + pagination
├── playlistOrchestrator.ts    # Coordinates playlist conversion + progress
└── downloadOrchestrator.ts    # Coordinates download + conversion + progress
```

### 2. ESLint Architectural Rules

**Goal:** Enforce architectural boundaries at lint time

**Rules:**
```javascript
// .eslintrc.js
rules: {
  'no-restricted-imports': ['error', {
    patterns: [
      {
        group: ['**/services/**'],
        importNames: ['*Store'],
        message: 'Services cannot import stores. Use callbacks instead.'
      }
    ]
  }]
}
```

### 3. State Machine for Complex Flows

**Goal:** Make state transitions explicit and type-safe

**Example:**
```typescript
type SearchState =
  | { status: 'idle' }
  | { status: 'loading'; query: string; tab: SearchTab }
  | { status: 'success'; query: string; results: SearchResults }
  | { status: 'error'; query: string; error: SearchError };
```

---

## Conclusion

This architecture provides:
- ✅ **Type Safety**: Compile-time error handling
- ✅ **Testability**: Pure services, isolated stores
- ✅ **Maintainability**: Clear separation of concerns
- ✅ **Performance**: Batched updates, request deduplication
- ✅ **Reliability**: Invariant enforcement, structured errors
- ✅ **Developer Experience**: Clear patterns, auto-completion

Follow these patterns when adding new features to maintain consistency and quality.
