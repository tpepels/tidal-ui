# Patterns Quick Reference

> **TL;DR:** Copy-paste templates for common patterns. See [ARCHITECTURE.md](ARCHITECTURE.md) for full explanations.

---

## Service Function Template

```typescript
// 1. Define error types (discriminated union)
export type YourServiceError =
  | { code: 'INVALID_INPUT'; retry: false; message: string }
  | { code: 'NETWORK_ERROR'; retry: true; message: string; originalError?: unknown }
  | { code: 'NOT_FOUND'; retry: false; message: string; id: string }
  | { code: 'UNKNOWN_ERROR'; retry: false; message: string; originalError?: unknown };

// 2. Define result type
export type YourServiceResult =
  | { success: true; data: YourDataType }
  | { success: false; error: YourServiceError };

// 3. Define options (if needed)
export interface YourServiceOptions {
  timeout?: number;
  callbacks?: {
    onProgress?: (progress: number) => void;
    onComplete?: (data: YourDataType) => void;
    onError?: (error: YourServiceError) => void;
  };
}

// 4. Error classifier
function classifyYourError(error: unknown): YourServiceError {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();

    if (message.includes('network')) {
      return { code: 'NETWORK_ERROR', retry: true, message: error.message, originalError: error };
    }

    if (message.includes('not found')) {
      return { code: 'NOT_FOUND', retry: false, message: error.message, id: extractId(error) };
    }

    return { code: 'UNKNOWN_ERROR', retry: false, message: error.message, originalError: error };
  }

  return {
    code: 'UNKNOWN_ERROR',
    retry: false,
    message: typeof error === 'string' ? error : 'Unknown error',
    originalError: error
  };
}

// 5. Service function
export async function yourService(
  requiredParam: string,
  options?: YourServiceOptions
): Promise<YourServiceResult> {
  // Validate input
  if (!requiredParam) {
    return {
      success: false,
      error: { code: 'INVALID_INPUT', retry: false, message: 'Parameter is required' }
    };
  }

  try {
    // Do work
    const data = await doSomething(requiredParam);

    // Notify success
    options?.callbacks?.onComplete?.(data);

    return { success: true, data };
  } catch (error) {
    const classifiedError = classifyYourError(error);

    // Notify error
    options?.callbacks?.onError?.(classifiedError);

    return { success: false, error: classifiedError };
  }
}
```

---

## Component Usage Template

```svelte
<script lang="ts">
  import { yourService, type YourServiceResult } from '$lib/services/...';
  import { yourStore } from '$lib/stores/...';

  let loading = false;
  let error: string | null = null;
  let data: YourDataType | null = null;

  async function handleAction() {
    loading = true;
    error = null;

    const result = await yourService(input, {
      callbacks: {
        onProgress: (progress) => {
          // Update progress UI
          loadingMessage = `Processing ${progress}%...`;
        },
        onComplete: (resultData) => {
          // Update store if needed
          yourStore.set(resultData);
        },
        onError: (err) => {
          // Could handle error here, but we also check result below
          console.error('Service error:', err);
        }
      }
    });

    loading = false;

    if (result.success) {
      // Handle success
      data = result.data;
      toast.success('Operation completed!');
    } else {
      // Handle error with type-safe discrimination
      switch (result.error.code) {
        case 'NETWORK_ERROR':
          if (result.error.retry) {
            error = 'Network error. Please try again.';
            showRetryButton = true;
          }
          break;

        case 'NOT_FOUND':
          error = `Item ${result.error.id} not found.`;
          break;

        case 'INVALID_INPUT':
          error = 'Invalid input. Please check your entry.';
          break;

        default:
          error = result.error.message;
      }

      console.error(`[Component] Error ${result.error.code}:`, result.error);
    }
  }
</script>
```

---

## Orchestrator Template

Orchestrators coordinate multi-service workflows and manage complex state machines.

```typescript
// 1. Define options interface
export interface YourOrchestratorOptions {
  /** Option 1 description */
  option1?: boolean;

  /** Option 2 description */
  option2?: string;

  /** Optional callbacks for extensibility */
  onProgress?: (progress: YourProgressData) => void;

  /** AbortSignal for cancellation */
  signal?: AbortSignal;
}

// 2. Define result type (similar to services)
export type YourOrchestratorResult =
  | { success: true; data: YourDataType }
  | { success: false; error: YourOrchestratorError };

// 3. Define error types
export type YourOrchestratorError =
  | { code: 'VALIDATION_FAILED'; retry: false; message: string }
  | { code: 'SERVICE_ERROR'; retry: true; message: string; originalError?: unknown }
  | { code: 'CANCELLED'; retry: false; message: string };

// 4. Orchestrator class
export class YourOrchestrator {
  /** Private state for cancellation/cleanup */
  private activeController: AbortController | null = null;

  /**
   * Main orchestration method
   *
   * @param input - Primary input parameter
   * @param options - Orchestration options
   * @returns Promise resolving to result
   */
  async orchestrateWorkflow(
    input: YourInputType,
    options?: YourOrchestratorOptions
  ): Promise<YourOrchestratorResult> {
    const effectiveOptions = this.resolveOptions(options);

    // Validation
    if (!this.isValid(input)) {
      return {
        success: false,
        error: {
          code: 'VALIDATION_FAILED',
          retry: false,
          message: 'Input validation failed'
        }
      };
    }

    // Setup cancellation
    this.activeController = effectiveOptions.signal ? null : new AbortController();
    const signal = effectiveOptions.signal ?? this.activeController?.signal;

    try {
      // Step 1: Initialize store state
      yourStore.setLoading(true);

      // Step 2: Call first service
      const result1 = await service1(input, {
        callbacks: {
          onProgress: (progress) => {
            if (signal?.aborted) throw new Error('CANCELLED');
            yourStore.updateProgress(progress);
            effectiveOptions.onProgress?.(progress);
          }
        }
      });

      if (!result1.success) {
        yourStore.setError(result1.error.message);
        return { success: false, error: result1.error };
      }

      // Step 3: Call second service (using result from first)
      const result2 = await service2(result1.data);

      if (!result2.success) {
        yourStore.setError(result2.error.message);
        return { success: false, error: result2.error };
      }

      // Step 4: Finalize store state
      yourStore.setData(result2.data);
      yourStore.setLoading(false);

      return { success: true, data: result2.data };

    } catch (error) {
      const classifiedError = this.classifyError(error);

      if (classifiedError.code !== 'CANCELLED') {
        yourStore.setError(classifiedError.message);
      }

      return { success: false, error: classifiedError };

    } finally {
      this.activeController = null;
    }
  }

  /**
   * Cancels any in-progress workflow
   */
  cancelWorkflow(): void {
    if (this.activeController) {
      this.activeController.abort();
      this.activeController = null;
    }

    yourStore.setLoading(false);
  }

  // === PRIVATE HELPERS ===

  private isValid(input: YourInputType): boolean {
    return !!input && input.trim().length > 0;
  }

  private classifyError(error: unknown): YourOrchestratorError {
    if (error instanceof Error) {
      if (error.message === 'CANCELLED' || error.message.includes('abort')) {
        return {
          code: 'CANCELLED',
          retry: false,
          message: 'Workflow was cancelled'
        };
      }

      return {
        code: 'SERVICE_ERROR',
        retry: true,
        message: error.message,
        originalError: error
      };
    }

    return {
      code: 'SERVICE_ERROR',
      retry: false,
      message: typeof error === 'string' ? error : 'Unknown error',
      originalError: error
    };
  }

  private resolveOptions(
    options?: YourOrchestratorOptions
  ): Required<Omit<YourOrchestratorOptions, 'signal' | 'onProgress'>> &
      Pick<YourOrchestratorOptions, 'signal' | 'onProgress'> {
    return {
      option1: options?.option1 ?? true,
      option2: options?.option2 ?? 'default',
      onProgress: options?.onProgress,
      signal: options?.signal
    };
  }
}

// 5. Export singleton instance
export const yourOrchestrator = new YourOrchestrator();
```

### Component Usage

```svelte
<script lang="ts">
  import { yourOrchestrator } from '$lib/orchestrators';

  async function handleAction() {
    // Simple! Orchestrator handles all coordination
    const result = await yourOrchestrator.orchestrateWorkflow(input, {
      option1: true,
      onProgress: (progress) => {
        console.log('Progress:', progress);
      }
    });

    if (result.success) {
      toast.success('Workflow completed!');
    } else {
      if (result.error.retry) {
        toast.error(result.error.message, {
          action: { label: 'Retry', onClick: handleAction }
        });
      } else {
        toast.error(result.error.message);
      }
    }
  }
</script>
```

---

## Store with Invariants Template

```typescript
import { writable } from 'svelte/store';
import { validateInvariant } from '$lib/core/invariants';

// 1. Define state type
type YourStoreState = {
  items: Item[];
  isLoading: boolean;
  error: string | null;
  selectedId: string | null;
};

// 2. Create base store
const baseStore = writable<YourStoreState>({
  items: [],
  isLoading: false,
  error: null,
  selectedId: null
});

// 3. Define invariants
const enforceInvariants = (state: YourStoreState) => {
  // INVARIANT 1: Can't have error and loading at same time
  validateInvariant(
    !(state.error && state.isLoading),
    'Cannot have error while loading',
    { error: state.error, isLoading: state.isLoading }
  );

  // INVARIANT 2: Selected ID must exist in items
  validateInvariant(
    !state.selectedId || state.items.some(item => item.id === state.selectedId),
    'Selected ID must exist in items',
    { selectedId: state.selectedId, itemIds: state.items.map(i => i.id) }
  );

  return state;
};

// 4. Create update function that enforces invariants
const updateStore = (updater: (state: YourStoreState) => YourStoreState) => {
  baseStore.update((state) => enforceInvariants(updater(state)));
};

// 5. Export public API
export const yourStore = {
  subscribe: baseStore.subscribe
};

// 6. Export actions
export const yourStoreActions = {
  setItems(items: Item[]) {
    updateStore((state) => ({
      ...state,
      items,
      error: null,
      isLoading: false
    }));
  },

  setLoading(isLoading: boolean) {
    updateStore((state) => ({
      ...state,
      isLoading,
      error: isLoading ? null : state.error  // Auto-correct: clear error when loading
    }));
  },

  setError(error: string) {
    updateStore((state) => ({
      ...state,
      error,
      isLoading: false  // Auto-correct: stop loading when error
    }));
  }
};
```

---

## Progress Batching Template

```typescript
export interface YourOptions {
  onProgress?: (progress: ProgressData) => void;
  progressBatchSize?: number;      // Default: 5
  progressThrottleMs?: number;     // Default: 100
}

export async function batchedOperation(
  items: Item[],
  options?: YourOptions
): Promise<Result[]> {
  const batchSize = options?.progressBatchSize ?? 5;
  const throttleMs = options?.progressThrottleMs ?? 100;
  const onProgress = options?.onProgress;

  let lastProgressTime = 0;
  let progressUpdatesPending = false;

  const reportProgress = (current: number, total: number, force: boolean = false) => {
    if (!onProgress) return;

    const now = Date.now();
    const shouldThrottle = now - lastProgressTime < throttleMs;
    const shouldBatch = current % batchSize !== 0;

    // Only report if: forced, OR (not batched AND not throttled)
    if (force || (!shouldBatch && !shouldThrottle)) {
      onProgress({
        current,
        total,
        percentage: Math.round((current / total) * 100)
      });
      lastProgressTime = now;
      progressUpdatesPending = false;
    } else {
      progressUpdatesPending = true;
    }
  };

  // Report initial progress
  reportProgress(0, items.length, true);

  // Process items
  const results: Result[] = [];
  for (let i = 0; i < items.length; i++) {
    const result = await processItem(items[i]);
    results.push(result);

    // Report batched progress
    reportProgress(i + 1, items.length, false);
  }

  // Report final progress (if last batch was skipped)
  if (progressUpdatesPending) {
    reportProgress(items.length, items.length, true);
  }

  return results;
}
```

---

## Error Handling Checklist

When adding a new service:

- [ ] Define error type with discriminated union
- [ ] Each error variant has `code`, `retry`, and `message`
- [ ] Include contextual data (statusCode, id, etc.) where relevant
- [ ] Define `Result<T, E>` type as union of success/failure
- [ ] Create `classifyError()` function to categorize errors
- [ ] Service returns Result type, NEVER throws
- [ ] Use callbacks for side effects, NOT store imports
- [ ] Document which errors can occur and when

---

## Invariant Validation Checklist

When adding store invariants:

- [ ] Use `validateInvariant()` utility from `$lib/core/invariants`
- [ ] Write clear invariant description
- [ ] Include context object with relevant state
- [ ] Enforce invariants in `updateStore()` wrapper
- [ ] Consider auto-correction for common violations
- [ ] Document invariants in comments
- [ ] Test invariants throw in dev mode

---

## Common Patterns

### Request Deduplication

```typescript
const inFlightRequests = new Map<string, Promise<Result>>();

export async function deduplicatedRequest(key: string): Promise<Result> {
  let pending = inFlightRequests.get(key);

  if (!pending) {
    pending = executeRequest(key);
    inFlightRequests.set(key, pending);
  }

  try {
    return await pending;
  } finally {
    if (inFlightRequests.get(key) === pending) {
      inFlightRequests.delete(key);
    }
  }
}
```

### Exponential Backoff Retry

```typescript
async function fetchWithRetry<T>(
  action: () => Promise<T>,
  attempts = 3,
  delayMs = 250
): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await action();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  throw lastError;
}
```

### Callback to Store Wiring

```svelte
<script lang="ts">
  import { downloadTrack } from '$lib/services/playback';
  import { downloadUiStore } from '$lib/stores/downloadUi';

  async function handleDownload(track: Track) {
    // 1. Create task in store
    const { taskId, controller } = downloadUiStore.beginTrackDownload(track, filename);

    // 2. Call service with callbacks wired to store
    const result = await downloadTrack(track, {
      signal: controller.signal,
      callbacks: {
        onProgress: (event) => {
          downloadUiStore.updateTrackProgress(taskId, event.receivedBytes, event.totalBytes);
        },
        onComplete: (filename) => {
          downloadUiStore.completeTrackDownload(taskId);
        },
        onError: (error) => {
          downloadUiStore.errorTrackDownload(taskId, error.message);
        },
        onCancel: () => {
          downloadUiStore.completeTrackDownload(taskId);
        }
      }
    });

    // 3. Handle result if needed
    if (!result.success) {
      console.error('Download failed:', result.error);
    }
  }
</script>
```

---

## DO ✅

- Return `Result<T, E>` from all async services
- Use discriminated unions for errors with `code`, `retry`, `message`
- Accept callbacks in options for side effects
- Validate invariants in every store update
- Use `validateInvariant()` utility
- Document error codes and when they occur
- Keep services pure (no store imports)
- Auto-correct invalid states where possible
- Batch progress updates for performance
- Use type-safe error handling in components

---

## DON'T ❌

- Throw exceptions from services (use Result types)
- Return string errors (use structured error objects)
- Call stores directly from services (use callbacks)
- Create circular dependencies (services ↔ stores)
- Skip invariant validation in stores
- Mix business logic with presentation logic
- Use `any` or `unknown` for errors (use discriminated unions)
- Call progress callbacks on every iteration (batch them)
- Silently ignore errors (log with context)
- Forget to check `result.success` in components

---

## Quick Debug Guide

### "Service error not showing in UI"
✅ Check: Component is checking `result.success` and handling error case
✅ Check: Error callback is wired to store update
✅ Check: Error state is in store's reactive state

### "Invariant violation in development"
✅ Check: State transition violates documented invariant
✅ Check: Auto-correction logic in store action
✅ This is GOOD - the invariant caught a bug!

### "Progress UI not updating"
✅ Check: Callback is being invoked (console.log in callback)
✅ Check: Batch size and throttle settings
✅ Check: Store update is triggering reactivity

### "Type error on service result"
✅ Check: Using `if (result.success)` type guard
✅ Check: Error type is imported from service module
✅ Check: All error codes in switch statement

---

## See Also

- [ARCHITECTURE.md](ARCHITECTURE.md) - Full architecture guide
- [STABILIZATION_SPRINT_SUMMARY.md](STABILIZATION_SPRINT_SUMMARY.md) - What changed and why
- `src/lib/core/invariants.ts` - Invariant validation utility
- `src/lib/services/` - Service implementations for reference
