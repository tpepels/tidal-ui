# Project Restructure Proposal

**Goal**: Clean up the root directory by consolidating documentation, scripts, and configuration files into logical subdirectories.

## Current State (Root Directory)
```
📁 tidal-ui/
├── 📄 9 markdown documentation files (280+ KB)
├── 📄 12 configuration files (.json, .js, .ts, .jsonc)
├── 📄 4 certificate/server files (cert.pem, key.pem, server.js, start.sh)
├── 📄 2 test scripts (test-apis.cjs, plus scripts/ dir)
├── 📄 1 Redis dump file (dump.rdb)
├── 📁 6 build/artifact directories (build/, coverage/, test-results/, etc.)
├── 📁 4 source directories (src/, static/, tests/, docs/)
```

**Problem**: 40+ items in root directory makes navigation difficult and obscures important files.

---

## Proposed Structure

### Phase 1: Documentation Consolidation

Move all documentation to a single `docs/` hierarchy:

```
📁 docs/
├── 📁 architecture/          # Architecture & patterns
│   ├── ARCHITECTURE.md       # ← moved from root
│   ├── PATTERNS_QUICK_REFERENCE.md  # ← moved from root
│   └── implementation/       # Implementation summaries
│       ├── orchestrator-implementation.md  # ← from ORCHESTRATOR_IMPLEMENTATION_SUMMARY.md
│       ├── stabilization-sprint.md         # ← from STABILIZATION_SPRINT_SUMMARY.md
│       └── final-summary.md                # ← from FINAL_IMPLEMENTATION_SUMMARY.md
│
├── 📁 api/                   # API documentation (already exists)
│   ├── API_ENDPOINT_REFERENCE.md
│   ├── SEARCH_API_SPEC.md
│   └── api-proxy-status.md  # ← moved from root API-PROXY-STATUS.md
│
├── 📁 development/           # Development guides
│   ├── AGENTS.md             # ← moved from root
│   ├── testing/
│   │   └── redis-testing.md # ← moved from root REDIS_TESTING.md
│   └── README.md             # Link to main README
│
├── 📁 process/               # Already exists (audits, TDD)
│   ├── audits/
│   └── TDD_TODO_V4.md
│
└── 📁 specs/                 # Already exists (V3_SPEC, etc.)
    ├── V3_SPEC.md
    ├── api-endpoints.yaml
    └── state-ownership.md
```

**Keep in root**: `README.md` only

---

### Phase 2: Configuration Consolidation

Group configuration files by purpose:

```
📁 config/
├── 📁 build/                 # Build & bundler configs
│   ├── vite.config.ts        # ← moved from root
│   ├── svelte.config.js      # ← moved from root
│   └── tsconfig.json         # ← moved from root
│
├── 📁 test/                  # Test configurations
│   ├── vitest.config.ts      # ← moved from root
│   └── playwright.config.ts  # ← moved from root
│
├── 📁 lint/                  # Linting & formatting
│   └── eslint.config.js      # ← moved from root
│
└── 📁 deploy/                # Deployment configs
    ├── docker-compose.yml    # ← moved from root
    ├── Dockerfile            # ← moved from root
    └── wrangler.jsonc        # ← moved from root
```

**Keep in root**: `package.json`, `package-lock.json`, `bun.lock` (required by package managers)

**Update Required**: Update imports/references in:
- `package.json` scripts
- `.vscode/settings.json` (if exists)
- GitHub Actions workflows (if any)

---

### Phase 3: Scripts & Tools Consolidation

```
📁 scripts/
├── 📁 dev/                   # Development utilities
│   ├── server.js             # ← moved from root (HTTPS dev server)
│   ├── start.sh              # ← moved from root (Redis + server)
│   └── test-apis.cjs         # ← moved from root (API health check)
│
├── 📁 api/                   # API testing/validation
│   ├── check-api-health.cjs  # ← already in scripts/
│   └── validate-api-tests.cjs # ← already in scripts/
│
└── README.md                 # Documentation for all scripts
```

**Action Items**:
1. Create `scripts/README.md` documenting:
   - What each script does
   - When to use them
   - Example usage
2. Update `package.json` scripts to reference new paths
3. Add npm scripts for common operations:
   ```json
   "scripts": {
     "dev:https": "node scripts/dev/server.js",
     "dev:with-redis": "bash scripts/dev/start.sh",
     "test:api-health": "node scripts/api/check-api-health.cjs"
   }
   ```

---

### Phase 4: Certificates & Secrets

```
📁 .certs/                    # Local HTTPS certificates
├── cert.pem                  # ← moved from root
├── key.pem                   # ← moved from root
└── .gitignore                # Ensure certs are ignored
```

**Security**:
- Add `.certs/` to `.gitignore`
- Update `scripts/dev/server.js` to reference new path
- Document in README how to generate certificates

---

### Phase 5: Cleanup - Files to Remove

#### 🗑️ Delete (Build Artifacts - Already Gitignored)
```bash
rm -rf build/          # Build output (regenerated)
rm -rf coverage/       # Test coverage reports (regenerated)
rm -rf test-results/   # Playwright test results (regenerated)
rm -rf playwright-report/  # Playwright HTML reports (regenerated)
rm dump.rdb            # Redis snapshot (not needed in repo)
```

#### 🗑️ Delete (Data - Should Not Be in Repo)
```bash
rm -rf data/           # Runtime data (what is this?)
```
**Action**: Check `data/` contents first - if it's test fixtures, move to `tests/fixtures/`

#### 📦 Archive (Historical Documentation)
These large summary files can be archived or deleted:
- `ORCHESTRATOR_IMPLEMENTATION_SUMMARY.md` (54 KB) → `docs/architecture/implementation/`
- `STABILIZATION_SPRINT_SUMMARY.md` (47 KB) → `docs/architecture/implementation/`
- `FINAL_IMPLEMENTATION_SUMMARY.md` (33 KB) → `docs/architecture/implementation/`

**Rationale**: These are point-in-time summaries. The canonical documentation is in `ARCHITECTURE.md` and `PATTERNS_QUICK_REFERENCE.md`.

---

## Final Root Directory Structure

After restructure:

```
📁 tidal-ui/
├── 📄 README.md              # Project overview
├── 📄 LICENSE                # License file
├── 📄 package.json           # Dependencies & scripts
├── 📄 package-lock.json      # Lock file
├── 📄 bun.lock               # Bun lock file
├── 📁 .certs/                # HTTPS certificates (gitignored)
├── 📁 config/                # All configuration files
├── 📁 docs/                  # All documentation
├── 📁 scripts/               # Utility scripts
├── 📁 src/                   # Source code
├── 📁 static/                # Static assets
└── 📁 tests/                 # Test files
```

**Result**: 12 items in root (down from 40+) ✅

---

## Migration Script

```bash
#!/bin/bash
# File: scripts/migrate-structure.sh

set -e  # Exit on error

echo "🚀 Starting project restructure..."

# Phase 1: Documentation
echo "📚 Phase 1: Organizing documentation..."
mkdir -p docs/architecture/implementation
mkdir -p docs/development/testing

mv ARCHITECTURE.md docs/architecture/
mv PATTERNS_QUICK_REFERENCE.md docs/architecture/
mv ORCHESTRATOR_IMPLEMENTATION_SUMMARY.md docs/architecture/implementation/orchestrator-implementation.md
mv STABILIZATION_SPRINT_SUMMARY.md docs/architecture/implementation/stabilization-sprint.md
mv FINAL_IMPLEMENTATION_SUMMARY.md docs/architecture/implementation/final-summary.md
mv API-PROXY-STATUS.md docs/api/api-proxy-status.md
mv AGENTS.md docs/development/
mv REDIS_TESTING.md docs/development/testing/redis-testing.md

# Phase 2: Configuration
echo "⚙️  Phase 2: Organizing configuration files..."
mkdir -p config/{build,test,lint,deploy}

mv vite.config.ts config/build/
mv svelte.config.js config/build/
mv tsconfig.json config/build/
mv vitest.config.ts config/test/
mv playwright.config.ts config/test/
mv eslint.config.js config/lint/
mv docker-compose.yml config/deploy/
mv Dockerfile config/deploy/
mv wrangler.jsonc config/deploy/

# Phase 3: Scripts
echo "🔧 Phase 3: Organizing scripts..."
mkdir -p scripts/{dev,api}

mv server.js scripts/dev/
mv start.sh scripts/dev/
mv test-apis.cjs scripts/dev/
# Note: check-api-health.cjs and validate-api-tests.cjs already in scripts/
mv scripts/check-api-health.cjs scripts/api/
mv scripts/validate-api-tests.cjs scripts/api/

# Phase 4: Certificates
echo "🔐 Phase 4: Securing certificates..."
mkdir -p .certs
mv cert.pem .certs/ 2>/dev/null || true
mv key.pem .certs/ 2>/dev/null || true

# Add to gitignore if not already present
grep -q "^\.certs/" .gitignore || echo ".certs/" >> .gitignore

# Phase 5: Cleanup
echo "🗑️  Phase 5: Removing build artifacts..."
rm -rf build/ coverage/ test-results/ playwright-report/ 2>/dev/null || true
rm dump.rdb 2>/dev/null || true

# Check data/ directory
if [ -d "data" ]; then
    echo "⚠️  Warning: data/ directory exists. Please review contents before deleting."
    ls -la data/
fi

echo "✅ Restructure complete!"
echo ""
echo "📝 Next steps:"
echo "1. Update config file imports (run: npm run update-imports)"
echo "2. Update package.json script paths"
echo "3. Test build: npm run build"
echo "4. Test dev server: npm run dev"
echo "5. Commit changes"
```

---

## Required Updates After Migration

### 1. **vite.config.ts** (now in `config/build/`)
```typescript
// Update path to tsconfig
export default defineConfig({
  // ...
  resolve: {
    alias: {
      $lib: path.resolve(__dirname, '../../src/lib')
    }
  }
});
```

### 2. **svelte.config.js** (now in `config/build/`)
```javascript
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import adapter from '@sveltejs/adapter-auto';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    // Update paths if needed
  }
};

export default config;
```

### 3. **package.json** - Update Scripts
```json
{
  "scripts": {
    "dev": "vite dev --config config/build/vite.config.ts",
    "build": "vite build --config config/build/vite.config.ts",
    "check": "svelte-kit sync && svelte-check --tsconfig ./config/build/tsconfig.json",
    "lint": "eslint . --config config/lint/eslint.config.js",
    "test": "vitest --config config/test/vitest.config.ts",
    "test:e2e": "playwright test --config config/test/playwright.config.ts",
    "dev:https": "node scripts/dev/server.js",
    "dev:with-redis": "bash scripts/dev/start.sh",
    "test:api-health": "node scripts/api/check-api-health.cjs"
  }
}
```

### 4. **scripts/dev/server.js** - Update Certificate Paths
```javascript
import { handler } from '../../build/handler.js';
import { createServer } from 'https';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '../..');

const server = createServer(
  {
    cert: readFileSync(join(rootDir, '.certs/cert.pem')),
    key: readFileSync(join(rootDir, '.certs/key.pem'))
  },
  handler
);

server.listen(5000, () => {
  console.log('Server running on https://localhost:5000');
});
```

### 5. **.gitignore** - Add New Ignores
```gitignore
# Build outputs
/build
build/Release
*.tsbuildinfo

# Test artifacts
test-results/
coverage/
playwright-report/

# Certificates (local dev only)
.certs/

# Runtime data
dump.rdb
data/

# Lock files (keep package-lock, ignore others if not using)
# Uncomment if you standardize on one package manager:
# bun.lock
# package-lock.json
```

---

## Rollback Plan

If issues arise, rollback with:

```bash
#!/bin/bash
# File: scripts/rollback-structure.sh

# This script reverses the migration

echo "⏪ Rolling back restructure..."

# Documentation
mv docs/architecture/ARCHITECTURE.md .
mv docs/architecture/PATTERNS_QUICK_REFERENCE.md .
mv docs/architecture/implementation/orchestrator-implementation.md ORCHESTRATOR_IMPLEMENTATION_SUMMARY.md
mv docs/architecture/implementation/stabilization-sprint.md STABILIZATION_SPRINT_SUMMARY.md
mv docs/architecture/implementation/final-summary.md FINAL_IMPLEMENTATION_SUMMARY.md
mv docs/api/api-proxy-status.md API-PROXY-STATUS.md
mv docs/development/AGENTS.md .
mv docs/development/testing/redis-testing.md REDIS_TESTING.md

# Configuration
mv config/build/vite.config.ts .
mv config/build/svelte.config.js .
mv config/build/tsconfig.json .
mv config/test/vitest.config.ts .
mv config/test/playwright.config.ts .
mv config/lint/eslint.config.js .
mv config/deploy/docker-compose.yml .
mv config/deploy/Dockerfile .
mv config/deploy/wrangler.jsonc .

# Scripts
mv scripts/dev/server.js .
mv scripts/dev/start.sh .
mv scripts/dev/test-apis.cjs .
mv scripts/api/check-api-health.cjs scripts/
mv scripts/api/validate-api-tests.cjs scripts/

# Certificates
mv .certs/cert.pem . 2>/dev/null || true
mv .certs/key.pem . 2>/dev/null || true

echo "✅ Rollback complete!"
```

---

## Benefits

### ✅ **Improved Developer Experience**
- **Faster navigation**: Find files by category, not alphabetically
- **Clear structure**: Know where to add new files
- **Reduced cognitive load**: Only 12 items in root

### ✅ **Better Maintainability**
- **Grouped configs**: All test configs together, all build configs together
- **Centralized docs**: One place for all documentation
- **Explicit dependencies**: Config locations make build dependencies clear

### ✅ **Easier Onboarding**
- **New contributors**: Obvious where documentation lives
- **README-first**: Critical info stays in root
- **Logical hierarchy**: Matches mental model of project structure

### ✅ **Build Tool Support**
- Most tools support custom config paths via CLI flags
- Package.json scripts centralize configuration
- Modern monorepo tools (Nx, Turborepo) expect this structure

---

## Risks & Mitigations

### ⚠️ **Risk**: Tools expect configs in root
**Mitigation**: Most tools (Vite, Vitest, Playwright, ESLint) support custom paths via CLI flags. Update `package.json` scripts.

### ⚠️ **Risk**: CI/CD pipelines break
**Mitigation**:
1. Test locally first
2. Update GitHub Actions `.github/workflows/` to use new paths
3. Keep rollback script ready

### ⚠️ **Risk**: Editor/IDE integrations break
**Mitigation**:
1. Update `.vscode/settings.json` (if exists)
2. VSCode ESLint extension auto-detects `eslint.config.js` in subdirs
3. TypeScript extension uses `tsconfig.json` from workspace root or nearest parent

### ⚠️ **Risk**: Team disruption
**Mitigation**:
1. Run migration on feature branch first
2. Test all npm scripts work
3. Document changes in PR description
4. Provide migration guide for open PRs

---

## Timeline

### Week 1: Preparation
- [ ] Review `data/` directory contents
- [ ] Identify all CI/CD config files
- [ ] Test config paths with CLI flags locally
- [ ] Create migration & rollback scripts

### Week 2: Execution
- [ ] Run migration script
- [ ] Update all package.json scripts
- [ ] Update config file imports
- [ ] Test all npm scripts
- [ ] Update .gitignore

### Week 3: Validation
- [ ] Run full test suite
- [ ] Test dev server
- [ ] Test production build
- [ ] Test Docker build
- [ ] Test e2e tests

### Week 4: Finalization
- [ ] Update README with new structure
- [ ] Document new conventions
- [ ] Merge to main
- [ ] Notify team

---

## Alternative: Minimal Restructure

If full migration is too risky, start with **documentation only**:

```bash
# Minimal migration - docs only
mkdir -p docs/architecture/implementation
mv ORCHESTRATOR_IMPLEMENTATION_SUMMARY.md docs/architecture/implementation/
mv STABILIZATION_SPRINT_SUMMARY.md docs/architecture/implementation/
mv FINAL_IMPLEMENTATION_SUMMARY.md docs/architecture/implementation/

# Update README to link to new paths
```

Benefits:
- ✅ Immediate cleanup (remove 3 large files from root)
- ✅ Zero risk to build/test
- ✅ Easy to roll back
- ✅ Sets precedent for future organization

---

## Recommendation

**Proposed Approach**: **Phased Migration**

1. **Phase 1 (Low Risk)**: Documentation consolidation - Do first
2. **Phase 2 (Medium Risk)**: Scripts consolidation - Do second
3. **Phase 3 (Higher Risk)**: Configuration consolidation - Do last, test thoroughly

This allows incremental improvement with rollback points between each phase.

**Start with**: Documentation migration this week, then evaluate before proceeding.

---

## Questions to Answer Before Proceeding

1. **What is the `data/` directory?** (Test fixtures? User data? Runtime cache?)
2. **Are there CI/CD pipelines?** (GitHub Actions, GitLab CI, etc.)
3. **What package manager is primary?** (npm? bun? both?)
4. **Are there monorepo tools?** (Nx, Turborepo, Lerna?)
5. **Is there a .vscode/ directory?** (Need to update settings)

Once answered, proceed with confidence! 🚀
