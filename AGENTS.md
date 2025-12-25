# AGENTS.md - Tidal UI Development Guide

## Overview

This is a high-fidelity music streaming UI built with SvelteKit, TypeScript, and Tailwind CSS. The application provides lossless audio playback, comprehensive search, and download capabilities for Tidal music content.

## Commands

### Development

- **Dev server**: `npm run dev` - Starts the development server with hot reloading
- **Type check**: `npm run check` - Runs TypeScript type checking and SvelteKit sync
- **Type check (watch)**: `npm run check:watch` - Continuous type checking during development

### Building & Deployment

- **Build**: `npm run build` - Creates production build using Vite and SvelteKit adapter-node
- **Preview**: `npm run preview` - Serves the production build locally for testing

### Code Quality

- **Lint**: `npm run lint` - Runs ESLint with TypeScript and Svelte rules
- **Format**: `npm run format` - Formats code with Prettier (tabs, single quotes, 100 width, no trailing comma)
- **Prepare**: `npm run prepare` - Sets up Husky git hooks for pre-commit checks

### Testing

- **Test all**: `npm test` - Runs all Vitest tests in watch mode
- **Test run**: `npm run test:run` - Runs all tests once (CI mode)
- **Test single file**: `npx vitest run path/to/file.test.ts` - Runs specific test file
- **Test UI**: `npm run test:ui` - Opens Vitest UI for interactive test running
- **Test coverage**: `npm run test:coverage` - Runs tests with coverage reporting
- **E2E tests**: `npm run test:e2e` - Runs Playwright end-to-end tests
- **E2E UI**: `npm run test:e2e:ui` - Opens Playwright UI for debugging tests

## Code Style Guidelines

### Languages & Frameworks

- **Primary language**: TypeScript for all logic and type definitions
- **Component framework**: Svelte 5 for UI components
- **Build tool**: Vite with SvelteKit
- **Styling**: Tailwind CSS v4 with forms and typography plugins
- **Testing**: Vitest with jsdom environment for components, Node for services
- **Linting**: ESLint with TypeScript, Svelte, and Prettier integration
- **Formatting**: Prettier with Svelte and Tailwind plugins

### File Structure

```
src/
├── lib/
│   ├── components/     # Reusable Svelte components
│   ├── services/       # API service classes
│   ├── stores/         # Svelte stores for state management
│   ├── utils/          # Utility functions and helpers
│   ├── types.ts        # TypeScript type definitions
│   ├── constants.ts    # Application constants
│   ├── config.ts       # Configuration settings
│   └── errors.ts       # Error handling utilities
├── routes/             # SvelteKit route files
└── app.css            # Global styles and Tailwind imports
```

### Naming Conventions

- **Variables/Functions**: camelCase (e.g., `getAlbumData`, `trackTitle`)
- **Components**: PascalCase (e.g., `AudioPlayer.svelte`, `AlbumCard`)
- **Types/Interfaces**: PascalCase (e.g., `Track`, `AlbumDetails`)
- **Classes**: PascalCase (e.g., `ContentService`, `BaseApiService`)
- **Constants**: UPPER_SNAKE_CASE (e.g., `CACHE_TTL`, `API_BASE`)
- **Files**: kebab-case for routes, camelCase for components/services (e.g., `album-page.svelte`, `content.service.ts`)

### TypeScript Guidelines

- **Strict mode**: Enabled with no implicit any types
- **Interfaces over types**: Prefer interfaces for object shapes, types for unions/primitives
- **Null safety**: Use strict null checks, avoid optional chaining abuse
- **Generic constraints**: Use appropriate generic constraints for type safety
- **Import types**: Use `import type` for type-only imports to reduce bundle size
- **Avoid any**: Never use `any` type; use `unknown` for truly unknown values
- **Discriminated unions**: Use for related types with a common discriminant property

### Import Organization

- **External packages**: Import first, sorted alphabetically
- **Internal modules**: Import after externals, use `$lib/` aliases
- **Relative imports**: Only for files in the same directory or closely related
- **Type imports**: Group type-only imports separately with `import type`
- **Side effects**: Import CSS and other side-effect imports at the top

```typescript
// Good: Organized imports
import type { Album, Track } from '$lib/types';
import { get } from 'svelte/store';
import { ContentService } from '$lib/services/content.service';
import { formatDuration } from '$lib/utils';
```

### Error Handling

- **Custom error class**: Use `TidalError` for application-specific errors
- **Error wrapper**: Use `withErrorHandling` for consistent error handling
- **Retry logic**: Use `retryWithBackoff` for network requests
- **Error classification**: Distinguish between retryable and non-retryable errors
- **User messaging**: Provide user-friendly error messages via error boundaries

```typescript
import { TidalError, withErrorHandling } from '$lib/errors';

async function fetchAlbum(id: number) {
	return withErrorHandling(async () => {
		const response = await fetch(`/api/album/${id}`);
		if (!response.ok) {
			throw TidalError.fromApiResponse({
				status: response.status,
				statusText: response.statusText
			});
		}
		return response.json();
	}, `Failed to fetch album ${id}`);
}
```

### Async Programming

- **Prefer async/await**: Over Promise chains and callbacks
- **Error propagation**: Let async functions throw; handle errors at call sites
- **Concurrent operations**: Use `Promise.all` for independent async operations
- **Cancellation**: Consider AbortController for cancellable operations

```typescript
// Good: Clear async/await usage
async function loadAlbumPage(id: number) {
	const [album, tracks] = await Promise.all([
		contentService.getAlbum(id),
		contentService.getAlbumTracks(id)
	]);

	return { album, tracks };
}
```

### Component Guidelines

- **Reactive statements**: Use `$:` for derived reactive values
- **Store subscriptions**: Prefer store auto-subscription over manual `get()`
- **Event handlers**: Use descriptive names (e.g., `handlePlayClick`)
- **Props interface**: Define component props as TypeScript interface
- **Event forwarding**: Use `$$restProps` and `$$slots` appropriately
- **Performance**: Memoize expensive computations with reactive statements

```svelte
<script lang="ts">
  import type { Track } from '$lib/types';

  interface Props {
    track: Track;
    isPlaying: boolean;
  }

  let { track, isPlaying }: Props = $props();

  function handlePlayClick() {
    // Implementation
  }
</script>

<button onclick={handlePlayClick} class="play-button">
  {#if isPlaying}
    <PauseIcon />
  {:else}
    <PlayIcon />
  {/if}
</button>
```

### State Management

- **Svelte stores**: Use for global application state
- **Local state**: Use component-local state for component-specific data
- **Store patterns**: Use readable/writable stores appropriately
- **Store composition**: Combine stores with derived stores when needed

### Testing Guidelines

- **Test file naming**: `.test.ts` or `.spec.ts` extension
- **Mock external deps**: Mock API calls, external libraries, and browser APIs
- **Test environment**: jsdom for components, node for services
- **Assertion library**: Use Vitest's built-in assertions
- **Test structure**: Arrange-Act-Assert pattern
- **Async testing**: Use `async/await` in tests
- **Setup/teardown**: Use `beforeEach` for test isolation

```typescript
import { describe, it, expect, vi } from 'vitest';
import { ContentService } from './content.service';

describe('ContentService', () => {
	it('fetches album data successfully', async () => {
		// Arrange
		const service = new ContentService();
		const mockAlbum = { id: 1, title: 'Test Album' };

		// Mock the API call
		vi.mocked(fetch).mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(mockAlbum)
		} as Response);

		// Act
		const result = await service.getAlbum(1);

		// Assert
		expect(result).toEqual(mockAlbum);
	});
});
```

### API Integration

- **Service layer**: Use dedicated service classes extending `BaseApiService`
- **Caching**: Leverage built-in Redis caching with TTL configuration
- **Response validation**: Use Zod schemas for API response validation
- **Error handling**: Centralized error handling with retry logic
- **Request deduplication**: Automatic request deduplication via caching

### Styling Guidelines

- **Tailwind classes**: Use utility-first approach
- **Custom CSS**: Minimal, only for complex animations or overrides
- **CSS variables**: Use for theme values and performance optimizations
- **Responsive design**: Mobile-first approach with responsive utilities
- **Dark mode**: Support via CSS variables and data attributes

### Performance Considerations

- **Bundle splitting**: Automatic code splitting via SvelteKit
- **Image optimization**: Use `LazyImage` component for performance
- **List virtualization**: Consider for large lists (not yet implemented)
- **Memory leaks**: Clean up event listeners and timers
- **Caching strategy**: Aggressive caching for API responses and images

### Git Workflow

- **Pre-commit hooks**: Husky enforces linting and formatting
- **Branch naming**: feature/, bugfix/, hotfix/ prefixes
- **Commit messages**: Descriptive, imperative mood (e.g., "Add user authentication")
- **Pull requests**: Include description, screenshots for UI changes

### Environment Configuration

- **Environment variables**: Use `.env` files for configuration
- **Redis**: Optional caching backend configurable via environment
- **API endpoints**: Configurable base URLs for different environments
- **Feature flags**: Use environment variables for feature toggles

No Cursor or Copilot rules found.</content>
<parameter name="filePath">/home/tom/Projects/tidal-ui/AGENTS.md
