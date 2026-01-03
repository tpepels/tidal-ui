# Scripts Directory

Utility scripts for development, testing, and API management.

## Directory Structure

```
scripts/
├── dev/                    # Development utilities
│   ├── server.js           # HTTPS development server
│   ├── start.sh            # Start Redis + HTTPS server
│   └── test-apis.cjs       # Test TIDAL proxy API health
│
├── api/                    # API testing and validation
│   ├── check-api-health.cjs    # Monitor API endpoint health
│   └── validate-api-tests.cjs  # Validate API test coverage
│
├── migrate-structure.sh    # Project restructure migration
├── rollback-structure.sh   # Rollback restructure migration
└── README.md               # This file
```

---

## Development Scripts

### 🚀 `dev/server.js`

**Purpose**: HTTPS development server using self-signed certificates

**Usage**:
```bash
node scripts/dev/server.js
```

**What it does**:
- Creates an HTTPS server on `https://localhost:5000`
- Uses certificates from `.certs/cert.pem` and `.certs/key.pem`
- Serves the production build from `build/handler.js`

**When to use**:
- Testing HTTPS-only features (e.g., secure cookies, service workers)
- Testing production build locally
- Debugging SSL/TLS issues

**Prerequisites**:
- Build the project: `npm run build`
- Generate certificates (see below)

**Generate Self-Signed Certificates**:
```bash
# Create .certs directory
mkdir -p .certs

# Generate certificate and key
openssl req -x509 -newkey rsa:4096 -keyout .certs/key.pem -out .certs/cert.pem \
  -days 365 -nodes -subj "/CN=localhost"

# Verify
ls -lh .certs/
```

**Package.json script**:
```json
{
  "scripts": {
    "dev:https": "npm run build && node scripts/dev/server.js"
  }
}
```

---

### 🔄 `dev/start.sh`

**Purpose**: Start Redis and HTTPS server together

**Usage**:
```bash
bash scripts/dev/start.sh
```

**What it does**:
1. Starts Redis server as daemon with:
   - No persistence (`--save ""`)
   - No append-only file (`--appendonly no`)
2. Waits 2 seconds for Redis to initialize
3. Starts the HTTPS server (`server.js`)

**When to use**:
- Full local development environment with Redis caching
- Testing Redis-dependent features
- Simulating production-like environment

**Prerequisites**:
- Redis installed: `redis-server --version`
- Build the project: `npm run build`
- HTTPS certificates generated

**Stop services**:
```bash
# Stop HTTPS server: Ctrl+C

# Stop Redis
redis-cli shutdown
```

**Package.json script**:
```json
{
  "scripts": {
    "dev:with-redis": "npm run build && bash scripts/dev/start.sh"
  }
}
```

---

### 🔍 `dev/test-apis.cjs`

**Purpose**: Test health of TIDAL proxy API endpoints

**Usage**:
```bash
node scripts/dev/test-apis.cjs
```

**What it does**:
- Tests a list of potential TIDAL proxy APIs
- Makes test search requests to each endpoint
- Reports which APIs are working/not working
- Timeout: 5 seconds per endpoint

**Output**:
```
Testing Tidal proxy APIs...

Results:
✅ WORKING: https://triton.squid.wtf
✅ WORKING: https://tidal.kinoplus.online
❌ TIMEOUT: https://api.tidal.com
❌ 404: https://tidal-api.vercel.app

Found 2 working APIs
```

**When to use**:
- Debugging "API not responding" errors
- Finding alternative proxy endpoints
- Monitoring API availability
- Before deploying to production

**Customize API list**:
Edit `potentialAPIs` array in the script to test different endpoints.

**Package.json script**:
```json
{
  "scripts": {
    "test:api-health": "node scripts/dev/test-apis.cjs"
  }
}
```

---

## API Scripts

### 🏥 `api/check-api-health.cjs`

**Purpose**: Monitor API endpoint health with detailed diagnostics

**Usage**:
```bash
node scripts/api/check-api-health.cjs
```

**What it does**:
- Tests configured API endpoints
- Measures response times
- Checks for common errors (404, 500, timeouts)
- Provides detailed error diagnostics

**When to use**:
- Continuous API monitoring
- CI/CD health checks
- Debugging intermittent API issues

**Package.json script**:
```json
{
  "scripts": {
    "check:api": "node scripts/api/check-api-health.cjs"
  }
}
```

---

### ✅ `api/validate-api-tests.cjs`

**Purpose**: Validate API test coverage and correctness

**Usage**:
```bash
node scripts/api/validate-api-tests.cjs
```

**What it does**:
- Analyzes test files for API endpoint coverage
- Ensures all endpoints have tests
- Validates test structure
- Reports missing coverage

**When to use**:
- Before committing API changes
- In CI/CD to enforce test quality
- Auditing test coverage

**Package.json script**:
```json
{
  "scripts": {
    "validate:tests": "node scripts/api/validate-api-tests.cjs"
  }
}
```

---

## Migration Scripts

### 📦 `migrate-structure.sh`

**Purpose**: Reorganize project structure (docs, configs, scripts)

**Usage**:
```bash
bash scripts/migrate-structure.sh
```

**What it does**:
- Moves documentation to `docs/` hierarchy
- Organizes scripts into `scripts/dev/` and `scripts/api/`
- Groups configs into `config/` subdirectories
- Moves certificates to `.certs/`
- Cleans up build artifacts
- Updates `.gitignore`

**Safe to run multiple times** - skips already moved files.

**See**: `RESTRUCTURE_PROPOSAL.md` for full details

---

### ⏪ `rollback-structure.sh`

**Purpose**: Rollback migration and restore original structure

**Usage**:
```bash
bash scripts/rollback-structure.sh
```

**What it does**:
- Moves all files back to root directory
- Removes empty directories
- Restores original structure

**Safe to run multiple times** - skips already restored files.

**Note**: If you updated `package.json` or config files, you'll need to restore those changes manually.

---

## Common Workflows

### Local Development with HTTPS + Redis
```bash
# 1. Generate certificates (once)
mkdir -p .certs
openssl req -x509 -newkey rsa:4096 -keyout .certs/key.pem -out .certs/cert.pem \
  -days 365 -nodes -subj "/CN=localhost"

# 2. Start dev environment
npm run build
bash scripts/dev/start.sh

# 3. Visit https://localhost:5000
# (Accept self-signed certificate warning in browser)
```

### API Health Check
```bash
# Quick check
node scripts/dev/test-apis.cjs

# Detailed diagnostics
node scripts/api/check-api-health.cjs
```

### Before Deployment
```bash
# 1. Validate tests
node scripts/api/validate-api-tests.cjs

# 2. Check API health
node scripts/api/check-api-health.cjs

# 3. Run full test suite
npm test

# 4. Build production
npm run build

# 5. Test production build
node scripts/dev/server.js
```

---

## Troubleshooting

### "Cannot find module" errors
**Solution**: Ensure you're running scripts from project root or using `npm run` commands.

### Redis connection errors
**Solution**:
```bash
# Check if Redis is running
redis-cli ping

# If not, start it
redis-server --daemonize yes

# Or use start.sh which starts Redis automatically
bash scripts/dev/start.sh
```

### Certificate errors in browser
**Solution**: Self-signed certificates will show warnings. This is expected for local development.
- Chrome/Edge: Click "Advanced" → "Proceed to localhost"
- Firefox: Click "Advanced" → "Accept the Risk"

For production, use valid certificates from Let's Encrypt or similar.

### API tests failing
**Solution**:
1. Check internet connection
2. Verify proxy APIs are working: `node scripts/dev/test-apis.cjs`
3. Check if API endpoint changed in `src/lib/config.ts`

---

## Contributing

When adding new scripts:

1. **Place in correct directory**:
   - Development utilities → `scripts/dev/`
   - API-related → `scripts/api/`
   - Build/deployment → `scripts/build/`

2. **Make executable**: `chmod +x scripts/your-script.sh`

3. **Add shebang**: `#!/bin/bash` or `#!/usr/bin/env node`

4. **Document here**: Update this README with:
   - Purpose
   - Usage
   - What it does
   - When to use
   - Prerequisites

5. **Add to package.json**: Create npm script alias for convenience

---

## References

- [RESTRUCTURE_PROPOSAL.md](../RESTRUCTURE_PROPOSAL.md) - Project restructure details
- [docs/architecture/ARCHITECTURE.md](../docs/architecture/ARCHITECTURE.md) - Project architecture
- [docs/development/](../docs/development/) - Development guides
