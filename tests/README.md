# OpenAgentic Test Harness

Comprehensive testing platform for OpenAgentic - covering every feature, function, and integration point across the entire stack.

## Quick Start

```bash
# Install dependencies
cd tests
npm install

# Run all tests
npm run test:all

# Open test dashboard UI
npm run dashboard
```

## Test Categories

### 1. E2E Tests (Playwright)
End-to-end tests for UI and API interactions.

```bash
# Run all E2E tests
npm run test:e2e

# Run with UI (interactive)
npm run test:e2e:ui

# Run specific project
npx playwright test --project=ui-chrome
npx playwright test --project=api
```

### 2. Unit Tests (Vitest)
Fast unit tests for individual functions and modules.

```bash
# Run unit tests
npm run test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

### 3. Integration Tests
Tests for service integrations (database, Redis, Milvus, providers).

```bash
npm run test:integration
```

### 4. Load Tests (k6)
Performance and stress testing.

```bash
# Smoke test (quick verification)
npm run test:load

# Stress test (find breaking points)
npm run test:load:stress
```

## Test Coverage by Feature

### Authentication & Security
- [x] Local JWT authentication
- [x] API key authentication (oa_* user keys / oa_sys_* system tokens; base64url, 43-char body)
- [x] Azure AD token validation
- [x] Token expiration handling
- [x] Admin authorization
- [x] Rate limiting

### Chat Functionality
- [x] Session creation/management
- [x] Message streaming (SSE)
- [x] Intelligence Slider integration
- [x] Model routing
- [x] File attachments
- [x] Message history
- [x] Context management

### MCP Integration
- [x] MCP Proxy health
- [x] Tool discovery
- [x] Tool execution
- [x] Memory MCP
- [x] Admin MCP
- [x] Diagram MCP
- [x] Web Search MCP
- [x] Flowise MCP

### Admin Portal
- [x] Dashboard metrics
- [x] User management
- [x] Permission controls
- [x] API key management
- [x] System settings
- [x] Intelligence slider
- [x] Audit logging
- [x] Analytics

### UI Components
- [x] Chat interface
- [x] Session management
- [x] Streaming display
- [x] Tool execution display
- [x] Keyboard shortcuts
- [x] Responsive design
- [x] Mobile compatibility

### Infrastructure
- [x] PostgreSQL connection
- [x] Redis caching
- [x] Milvus vector search
- [x] LLM provider health
- [x] Flowise integration

## Environment Configuration

### Docker Compose Testing
```bash
cp .env.docker .env.test
TEST_ENV=docker npm run test:e2e
```

### Helm/Kubernetes Testing
```bash
cp .env.helm .env.test
TEST_ENV=helm npm run test:e2e
```

### Local Development Testing
```bash
# Uses defaults (localhost)
npm run test:e2e
```

## Test Dashboard

Interactive UI for running and monitoring tests.

```bash
# Start dashboard
npm run dashboard

# Access at http://localhost:3100
```

Features:
- Run individual tests or suites
- Real-time log streaming
- Test result visualization
- Environment selection
- Coverage reports

## Generating Reports

### Allure Reports
```bash
# Generate report
npm run report

# Open in browser
npm run report:open
```

### HTML Reports
```bash
npx playwright show-report
```

## CI/CD Integration

### GitHub Actions
```yaml
- name: Run Tests
  run: |
    cd tests
    npm ci
    npm run test:all
  env:
    TEST_API_KEY: ${{ secrets.TEST_API_KEY }}
    TEST_ENV: docker
```

## Writing New Tests

### E2E Test Template
```typescript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test('should do something', async ({ page, request }) => {
    // Test implementation
  });
});
```

### Unit Test Template
```typescript
import { describe, it, expect } from 'vitest';

describe('FunctionName', () => {
  it('should work correctly', () => {
    expect(functionUnderTest()).toBe(expectedValue);
  });
});
```

## Troubleshooting

### Tests timing out
- Increase `TEST_TIMEOUT` in environment
- Check service health with `curl http://localhost:8000/health`

### Authentication failures
- Verify `TEST_API_KEY` is valid
- Check if token has expired

### Streaming tests failing
- Increase `TEST_SSE_TIMEOUT`
- Check `X-Accel-Buffering: no` header

## Project Structure

```
tests/
├── e2e/
│   ├── api/          # API endpoint tests
│   ├── ui/           # UI interaction tests
│   ├── mcp/          # MCP tool tests
│   └── flowise/      # Flowise workflow tests
├── integration/
│   ├── services/     # Service integration tests
│   ├── database/     # Database tests
│   └── providers/    # LLM provider tests
├── unit/
│   ├── api/          # API unit tests
│   ├── ui/           # UI component tests
│   └── mcp-proxy/    # MCP proxy tests
├── load/
│   └── scenarios/    # k6 load test scenarios
├── fixtures/         # Test data and setup
├── reports/          # Generated reports
├── ui-dashboard/     # Test dashboard UI
├── playwright.config.ts
├── vitest.config.ts
└── package.json
```

## Contact

For test harness issues, contact the platform team.
