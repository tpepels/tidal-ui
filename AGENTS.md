# AGENTS.md - Tidal UI Development Guide

## Commands

- Build: `npm run build`
- Dev server: `npm run dev`
- Lint: `npm run lint`
- Format: `npm run format`
- Type check: `npm run check`
- Test all: `npm test`
- Test single file: `npx vitest run path/to/file.test.ts`
- Test coverage: `npm run test:coverage`

## Code Style Guidelines

- **Language**: TypeScript for logic, Svelte for components
- **Formatting**: Prettier (tabs, single quotes, 100 width, no trailing comma)
- **Linting**: ESLint with TS/Svelte/Prettier configs
- **Imports**: Relative paths for internal, packages for external; sort alphabetically
- **Naming**: camelCase for vars/functions, PascalCase for components/types/classes
- **Types**: Use interfaces; avoid `any`; strict null checks
- **Error Handling**: Use TidalError with withErrorHandling wrapper
- **Async**: Prefer async/await over promises
- **Comments**: Minimal; only for complex logic
- **Testing**: Vitest with jsdom for components, node for services; mock external deps

No Cursor or Copilot rules found.
