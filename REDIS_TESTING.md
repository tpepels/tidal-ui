# Redis/Valkey Testing Instructions

## Infrastructure Setup

Redis/Valkey is now assumed to be available as infrastructure. The tests will use real Redis by default and only fall back to mocks if Redis is not available.

## Starting Valkey (Local Development)

```bash
valkey-server --daemonize yes --port 6379
```

## Testing Behavior

- **Default**: Tests use real Redis (assumes Redis is running on localhost:6379)
- **Fallback**: If Redis is not available, tests automatically use mocks
- **Integration**: All upload queue and persistence tests use real Redis operations

## Running Tests

```bash
# Run all tests (uses real Redis if available)
npm run test:run

# Run Redis-specific integration tests
npm run test:run -- src/lib/redis-integration.test.ts

# Run upload queue tests (use real Redis)
npm run test:run -- src/lib/upload-queue.test.ts
```

## CI/CD Setup

In CI environments, ensure Redis is available:

- Docker: `redis:latest`
- Services: Redis service on port 6379
- Environment: `REDIS_URL=redis://localhost:6379`

## Troubleshooting

- **Tests failing with Redis errors**: Start Valkey server first
- **Want to force mocks**: Remove Valkey and restart tests
- **Connection issues**: Check `redis://localhost:6379` is accessible
