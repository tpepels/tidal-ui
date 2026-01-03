#!/bin/bash
# Project Restructure Rollback Script
# This script reverses the migration and restores the original structure
# Safe to run multiple times

set -e  # Exit on error

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo "⏪ Rolling back project restructure..."
echo "Project root: $PROJECT_ROOT"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Function to move file back if it exists
move_back() {
    local src="$1"
    local dest="$2"

    if [ -f "$src" ]; then
        mv "$src" "$dest"
        echo -e "${GREEN}✓${NC} Restored: $src → $dest"
        return 0
    elif [ -f "$dest" ]; then
        echo -e "${YELLOW}⊘${NC} Already in place: $dest"
        return 0
    else
        echo -e "${YELLOW}⊘${NC} Not found (may not have been moved): $src"
        return 1
    fi
}

echo "📚 Phase 1: Restoring documentation..."
move_back "docs/architecture/ARCHITECTURE.md" "ARCHITECTURE.md" || true
move_back "docs/architecture/PATTERNS_QUICK_REFERENCE.md" "PATTERNS_QUICK_REFERENCE.md" || true
move_back "docs/architecture/implementation/orchestrator-implementation.md" "ORCHESTRATOR_IMPLEMENTATION_SUMMARY.md" || true
move_back "docs/architecture/implementation/stabilization-sprint.md" "STABILIZATION_SPRINT_SUMMARY.md" || true
move_back "docs/architecture/implementation/final-summary.md" "FINAL_IMPLEMENTATION_SUMMARY.md" || true
move_back "docs/api/api-proxy-status.md" "API-PROXY-STATUS.md" || true
move_back "docs/development/AGENTS.md" "AGENTS.md" || true
move_back "docs/development/testing/redis-testing.md" "REDIS_TESTING.md" || true

echo ""
echo "🔧 Phase 2: Restoring scripts..."
move_back "scripts/dev/server.js" "server.js" || true
move_back "scripts/dev/start.sh" "start.sh" || true
move_back "scripts/dev/test-apis.cjs" "test-apis.cjs" || true
move_back "scripts/api/check-api-health.cjs" "scripts/check-api-health.cjs" || true
move_back "scripts/api/validate-api-tests.cjs" "scripts/validate-api-tests.cjs" || true

echo ""
echo "⚙️  Phase 3: Restoring configuration files..."
move_back "config/build/vite.config.ts" "vite.config.ts" || true
move_back "config/build/svelte.config.js" "svelte.config.js" || true
move_back "config/build/tsconfig.json" "tsconfig.json" || true
move_back "config/test/vitest.config.ts" "vitest.config.ts" || true
move_back "config/test/playwright.config.ts" "playwright.config.ts" || true
move_back "config/lint/eslint.config.js" "eslint.config.js" || true
move_back "config/deploy/docker-compose.yml" "docker-compose.yml" || true
move_back "config/deploy/Dockerfile" "Dockerfile" || true
move_back "config/deploy/wrangler.jsonc" "wrangler.jsonc" || true

echo ""
echo "🔐 Phase 4: Restoring certificates..."
move_back ".certs/cert.pem" "cert.pem" || true
move_back ".certs/key.pem" "key.pem" || true

echo ""
echo "🗑️  Phase 5: Cleaning up empty directories..."

# Remove empty directories created by migration
rmdir docs/architecture/implementation 2>/dev/null && echo -e "${GREEN}✓${NC} Removed: docs/architecture/implementation/" || true
rmdir docs/architecture 2>/dev/null && echo -e "${GREEN}✓${NC} Removed: docs/architecture/" || true
rmdir docs/development/testing 2>/dev/null && echo -e "${GREEN}✓${NC} Removed: docs/development/testing/" || true
rmdir docs/development 2>/dev/null && echo -e "${GREEN}✓${NC} Removed: docs/development/" || true

rmdir scripts/dev 2>/dev/null && echo -e "${GREEN}✓${NC} Removed: scripts/dev/" || true
rmdir scripts/api 2>/dev/null && echo -e "${GREEN}✓${NC} Removed: scripts/api/" || true

rmdir config/build 2>/dev/null && echo -e "${GREEN}✓${NC} Removed: config/build/" || true
rmdir config/test 2>/dev/null && echo -e "${GREEN}✓${NC} Removed: config/test/" || true
rmdir config/lint 2>/dev/null && echo -e "${GREEN}✓${NC} Removed: config/lint/" || true
rmdir config/deploy 2>/dev/null && echo -e "${GREEN}✓${NC} Removed: config/deploy/" || true
rmdir config 2>/dev/null && echo -e "${GREEN}✓${NC} Removed: config/" || true

rmdir .certs 2>/dev/null && echo -e "${GREEN}✓${NC} Removed: .certs/" || true

echo ""
echo "✅ Rollback complete!"
echo ""
echo "📝 Next steps:"
echo "1. If you updated package.json, restore the original scripts"
echo "2. If you updated config files, restore the original paths"
echo "3. Test build: npm run build"
echo "4. Test dev server: npm run dev"
echo "5. Review changes: git status"
echo ""
echo "💡 To re-apply migration, run: bash scripts/migrate-structure.sh"
