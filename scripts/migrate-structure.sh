#!/bin/bash
# Project Restructure Migration Script
# This script reorganizes the tidal-ui project structure to improve maintainability
# Safe to run multiple times (will skip already moved files)

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "🚀 Starting project restructure migration..."
echo "Project root: $PROJECT_ROOT"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to move file if it exists
move_file() {
    local src="$1"
    local dest="$2"

    if [ -f "$src" ]; then
        mkdir -p "$(dirname "$dest")"
        mv "$src" "$dest"
        echo -e "${GREEN}✓${NC} Moved: $src → $dest"
        return 0
    elif [ -f "$dest" ]; then
        echo -e "${YELLOW}⊘${NC} Already moved: $dest"
        return 0
    else
        echo -e "${RED}✗${NC} Not found: $src"
        return 1
    fi
}

# Phase 1: Documentation (Already done, but included for completeness)
echo "📚 Phase 1: Organizing documentation..."
mkdir -p docs/architecture/implementation
mkdir -p docs/development/testing

move_file "ARCHITECTURE.md" "docs/architecture/ARCHITECTURE.md" || true
move_file "PATTERNS_QUICK_REFERENCE.md" "docs/architecture/PATTERNS_QUICK_REFERENCE.md" || true
move_file "ORCHESTRATOR_IMPLEMENTATION_SUMMARY.md" "docs/architecture/implementation/orchestrator-implementation.md" || true
move_file "STABILIZATION_SPRINT_SUMMARY.md" "docs/architecture/implementation/stabilization-sprint.md" || true
move_file "FINAL_IMPLEMENTATION_SUMMARY.md" "docs/architecture/implementation/final-summary.md" || true
move_file "API-PROXY-STATUS.md" "docs/api/api-proxy-status.md" || true
move_file "AGENTS.md" "docs/development/AGENTS.md" || true
move_file "REDIS_TESTING.md" "docs/development/testing/redis-testing.md" || true

echo ""

# Phase 2: Scripts
echo "🔧 Phase 2: Organizing scripts..."
mkdir -p scripts/dev
mkdir -p scripts/api

move_file "server.js" "scripts/dev/server.js" || true
move_file "start.sh" "scripts/dev/start.sh" || true
move_file "test-apis.cjs" "scripts/dev/test-apis.cjs" || true

# Move existing scripts if they're in wrong location
if [ -f "scripts/check-api-health.cjs" ]; then
    move_file "scripts/check-api-health.cjs" "scripts/api/check-api-health.cjs" || true
fi

if [ -f "scripts/validate-api-tests.cjs" ]; then
    move_file "scripts/validate-api-tests.cjs" "scripts/api/validate-api-tests.cjs" || true
fi

# Make shell scripts executable
chmod +x scripts/dev/start.sh 2>/dev/null || true
chmod +x scripts/dev/test-apis.cjs 2>/dev/null || true
chmod +x scripts/api/*.cjs 2>/dev/null || true

echo ""

# Phase 3: Configuration
echo "⚙️  Phase 3: Organizing configuration files..."
mkdir -p config/build
mkdir -p config/test
mkdir -p config/lint
mkdir -p config/deploy

move_file "vite.config.ts" "config/build/vite.config.ts" || true
move_file "svelte.config.js" "config/build/svelte.config.js" || true
move_file "tsconfig.json" "config/build/tsconfig.json" || true
move_file "vitest.config.ts" "config/test/vitest.config.ts" || true
move_file "playwright.config.ts" "config/test/playwright.config.ts" || true
move_file "eslint.config.js" "config/lint/eslint.config.js" || true
move_file "docker-compose.yml" "config/deploy/docker-compose.yml" || true
move_file "Dockerfile" "config/deploy/Dockerfile" || true
move_file "wrangler.jsonc" "config/deploy/wrangler.jsonc" || true

echo ""

# Phase 4: Certificates
echo "🔐 Phase 4: Securing certificates..."
mkdir -p .certs

if [ -f "cert.pem" ]; then
    move_file "cert.pem" ".certs/cert.pem" || true
fi

if [ -f "key.pem" ]; then
    move_file "key.pem" ".certs/key.pem" || true
fi

# Add to gitignore if not already present
if ! grep -q "^\.certs/" .gitignore 2>/dev/null; then
    echo -e "\n# Local HTTPS certificates\n.certs/" >> .gitignore
    echo -e "${GREEN}✓${NC} Added .certs/ to .gitignore"
fi

if ! grep -q "^data/" .gitignore 2>/dev/null; then
    echo -e "\n# Runtime upload state\ndata/" >> .gitignore
    echo -e "${GREEN}✓${NC} Added data/ to .gitignore"
fi

echo ""

# Phase 5: Cleanup
echo "🗑️  Phase 5: Cleaning up build artifacts..."

# Remove build artifacts (safe - regenerated)
rm -rf build/ 2>/dev/null && echo -e "${GREEN}✓${NC} Removed: build/" || echo -e "${YELLOW}⊘${NC} Already clean: build/"
rm -rf coverage/ 2>/dev/null && echo -e "${GREEN}✓${NC} Removed: coverage/" || echo -e "${YELLOW}⊘${NC} Already clean: coverage/"
rm -rf test-results/ 2>/dev/null && echo -e "${GREEN}✓${NC} Removed: test-results/" || echo -e "${YELLOW}⊘${NC} Already clean: test-results/"
rm -rf playwright-report/ 2>/dev/null && echo -e "${GREEN}✓${NC} Removed: playwright-report/" || echo -e "${YELLOW}⊘${NC} Already clean: playwright-report/"
rm -f dump.rdb 2>/dev/null && echo -e "${GREEN}✓${NC} Removed: dump.rdb" || echo -e "${YELLOW}⊘${NC} Already clean: dump.rdb"

# Check data/ directory
if [ -d "data" ]; then
    echo -e "${YELLOW}⚠${NC}  Warning: data/ directory exists. Contents:"
    ls -la data/
    echo ""
    echo "    This directory should be gitignored (runtime state)."
    echo "    If it contains important files, please review before deleting."
fi

echo ""
echo "✅ Migration complete!"
echo ""
echo "📝 Next steps:"
echo "1. Update package.json scripts (see RESTRUCTURE_PROPOSAL.md)"
echo "2. Update config file imports"
echo "3. Update scripts/dev/server.js certificate paths"
echo "4. Test build: npm run build"
echo "5. Test dev server: npm run dev"
echo "6. Review changes: git status"
echo "7. Commit: git add -A && git commit -m 'refactor: reorganize project structure'"
echo ""
echo "💡 To rollback, run: bash scripts/rollback-structure.sh"
