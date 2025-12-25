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

## ⚠️ CRITICAL API DEVELOPMENT GUIDELINES

### **DO NOT** Change Code to Make Tests Work

**STOP MODIFYING CODE TO PASS TESTS INSTEAD OF FIXING UNDERLYING ISSUES**

This has been a recurring problem causing constant regressions. When tests fail:

1. **Identify the root cause** - Do not modify implementation to match broken tests
2. **Fix the actual issue** - Address the underlying problem, not symptoms
3. **Update tests if needed** - Only after confirming the fix is correct
4. **Validate against working references** - Check against the documented API endpoints

### Working API Implementation Reference

**ALL API CHANGES MUST BE VALIDATED AGAINST:**

1. **Working API Code**: See `src/lib/api.ts` - This contains the validated, working implementation
2. **API Endpoint Documentation**: See `docs/API_ENDPOINT_REFERENCE.md` - Only documented endpoints are confirmed working
3. **OpenAPI Specification**: See `docs/specs/api-endpoints.yaml` - Official endpoint specifications
4. **Original Working Implementation**: Reference the comprehensive API code provided in commit history

### API Change Protocol

**BEFORE making ANY API changes:**

1. **Check References**: Verify changes align with `docs/API_ENDPOINT_REFERENCE.md`
2. **Test Against Working Code**: Compare with the implementation in `src/lib/api.ts`
3. **Validate Endpoints**: Ensure endpoints match OpenAPI spec in `docs/specs/api-endpoints.yaml`
4. **Run Full Test Suite**: All tests must pass, not just modified ones

**AFTER making API changes:**

1. **Update Documentation**: Modify `docs/API_ENDPOINT_REFERENCE.md` if endpoints change
2. **Update OpenAPI Spec**: Keep `docs/specs/api-endpoints.yaml` in sync
3. **Run API Health Checks**: Pre-commit hooks validate endpoint functionality
4. **Test Integration**: Ensure all services work with the updated API

### Preventing Regressions

- **Never modify implementation to pass tests** - Fix the root cause instead
- **Always reference working API code** before making changes
- **Use documented endpoints only** - See `docs/API_ENDPOINT_REFERENCE.md`
- **Keep OpenAPI spec updated** - `docs/specs/api-endpoints.yaml` is authoritative
- **Run pre-commit validations** - API health checks prevent broken deployments

## Code of Conduct

### Our Pledge

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone, regardless of age, body size, visible or invisible disability, ethnicity, sex characteristics, gender identity and expression, level of experience, education, socio-economic status, nationality, personal appearance, race, religion, or sexual identity and orientation.

We pledge to act and interact in ways that contribute to an open, welcoming, diverse, inclusive, and healthy community.

### Our Standards

Examples of behavior that contributes to a positive environment for our community include:

- Demonstrating empathy and kindness toward other people
- Being respectful of differing opinions, viewpoints, and experiences
- Giving and gracefully accepting constructive feedback
- Accepting responsibility and apologizing to those affected by our mistakes, and learning from the experience
- Focusing on what is best not just for us as individuals, but for the overall community

Examples of unacceptable behavior include:

- The use of sexualized language or imagery, and sexual attention or advances of any kind
- Trolling, insulting or derogatory comments, and personal or political attacks
- Public or private harassment
- Publishing others' private information, such as a physical or email address, without their explicit permission
- Other conduct which could reasonably be considered inappropriate in a professional setting

### Development Standards

In addition to community standards, we maintain high development standards:

- **Quality over Speed**: Take time to implement correctly rather than rushing broken code
- **Test-Driven Development**: Write tests that validate correct behavior, not broken implementations
- **Documentation First**: Update documentation before implementing changes
- **Peer Review**: All changes should be reviewed for correctness and adherence to standards
- **Accountability**: Accept responsibility for mistakes and learn from them

### Enforcement Responsibilities

Community leaders are responsible for clarifying and enforcing our standards of acceptable behavior and will take appropriate and fair corrective action in response to any behavior that they deem inappropriate, threatening, offensive, or harmful.

Community leaders have the right and responsibility to remove, edit, or reject comments, commits, code, wiki edits, issues, and other contributions that are not aligned to this Code of Conduct, and will communicate reasons for moderation decisions when appropriate.

### Development Enforcement

For development practices:

- **API Changes**: Must be validated against working references (`docs/API_ENDPOINT_REFERENCE.md`, `src/lib/api.ts`)
- **Test Failures**: Root causes must be identified and fixed, not worked around
- **Documentation**: Must be kept current with implementation changes
- **Code Quality**: Must pass all linting, type checking, and testing requirements

### Scope

This Code of Conduct applies within all community spaces, and also applies when an individual is officially representing the community in public spaces. Examples of representing our community include using an official e-mail address, posting via an official social media account, or acting as an appointed representative at an online or offline event.

### Enforcement

Instances of abusive, harassing, or otherwise unacceptable behavior may be reported to the community leaders responsible for enforcement at max@binimum.org.

All complaints will be reviewed and investigated promptly and fairly.

All community leaders are obligated to respect the privacy and security of the reporter of any incident.

### Development Enforcement Guidelines

Community leaders will follow these Development Impact Guidelines in determining the consequences for development practices:

#### 1. Correction

**Development Impact**: Quick fixes that bypass proper testing or documentation.

**Consequence**: A private, written warning from community leaders, providing clarity around the nature of the violation and an explanation of why the behavior was inappropriate. Code must be corrected properly.

#### 2. Warning

**Development Impact**: Repeated violations of development standards, such as modifying code to pass tests instead of fixing root causes.

**Consequence**: A warning with consequences for continued behavior. No code commits allowed until proper practices are demonstrated. This includes avoiding shortcuts in development processes.

#### 3. Temporary Ban

**Development Impact**: Serious violations causing system instability or data loss, such as breaking API endpoints without proper validation.

**Consequence**: A temporary ban from code contributions for a specified period of time. No commits or pull requests allowed during this period.

#### 4. Permanent Ban

**Development Impact**: Demonstrating a pattern of reckless development practices that endanger the project stability.

**Consequence**: A permanent ban from code contributions to the project.

### Attribution

This Code of Conduct is adapted from the [Contributor Covenant][homepage], version 2.0, available at https://www.contributor-covenant.org/version/2/0/code_of_conduct.html.

Community Impact Guidelines were inspired by [Mozilla's code of conduct enforcement ladder](https://github.com/mozilla/diversity).

[homepage]: https://www.contributor-covenant.org

For answers to common questions about this code of conduct, see the FAQ at https://www.contributor-covenant.org/faq. Translations are available at https://www.contributor-covenant.org/translations.

No Cursor or Copilot rules found.</content>
<parameter name="filePath">/home/tom/Projects/tidal-ui/AGENTS.md
