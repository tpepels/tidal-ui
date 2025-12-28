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
- **Test single file**: `npx vitest run src/lib/utils/formatters.test.ts` - Runs specific test file
- **Test pattern**: `npx vitest run --reporter=verbose **/utils/*.test.ts` - Runs tests matching pattern
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
- **Formatting**: Prettier with Svelte and Tailwind plugins (tabs, single quotes, 100 width, no trailing comma)

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

### Async Programming

- **Prefer async/await**: Over Promise chains and callbacks
- **Error propagation**: Let async functions throw; handle errors at call sites
- **Concurrent operations**: Use `Promise.all` for independent async operations
- **Cancellation**: Consider AbortController for cancellable operations

### Component Guidelines

- **Reactive statements**: Use `$:` for derived reactive values
- **Store subscriptions**: Prefer store auto-subscription over manual `get()`
- **Event handlers**: Use descriptive names (e.g., `handlePlayClick`)
- **Props interface**: Define component props as TypeScript interface
- **Event forwarding**: Use `$$restProps` and `$$slots` appropriately
- **Performance**: Memoize expensive computations with reactive statements

### Testing Guidelines

- **Test file naming**: `.test.ts` or `.spec.ts` extension
- **Mock external deps**: Mock API calls, external libraries, and browser APIs using `vi.mocked()`
- **Test environment**: jsdom for components, node for services
- **Assertion library**: Use Vitest's built-in assertions
- **Test structure**: Arrange-Act-Assert pattern
- **Async testing**: Use `async/await` in tests
- **Setup/teardown**: Use `beforeEach` for test isolation

```typescript
import { describe, it, expect, vi } from 'vitest';

describe('Formatters', () => {
	it('formats single artist', () => {
		const artists = [{ id: 1, name: 'Artist One', type: 'artist' }];
		expect(formatArtists(artists)).toBe('Artist One');
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

## Development Workflow

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

### Security Best Practices

- **Never introduce code that exposes secrets and keys**
- **Never commit secrets or keys to the repository**
- **Use environment variables for configuration**
- **Validate API responses with Zod schemas**

No Cursor or Copilot rules found.</content>
<parameter name="filePath">/home/tom/Projects/tidal-ui/AGENTS.md
