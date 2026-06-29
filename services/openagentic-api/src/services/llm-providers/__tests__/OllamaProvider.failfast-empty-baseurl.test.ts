/**
 * OllamaProvider — fail fast when baseUrl is empty.
 *
 * SEV-0 root cause (companion to nemotron3:33b leak fix): even after the
 * SmartModelRouter capability filter, *any* future provider that wires
 * up an Ollama row with an empty `baseUrl` (env unset, DB row blank)
 * will hang on `fetch('/api/tags')` for ~30s in `ensureModelExists`,
 * surfacing as "REQUEST_TIMEOUT" in the chat UI. The error is not
 * actionable for the user.
 *
 * Behavior contract (tested below):
 *   - createCompletion() with empty `baseUrl` rejects synchronously
 *     (no 30s wait) with a clear, operator-actionable error.
 *
 * No mocks of singletons; we just instantiate OllamaProvider directly
 * with config={} and rely on env not being set in the test runner.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { OllamaProvider } from '../OllamaProvider.js';

const noopLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(() => noopLogger),
} as any;

describe('OllamaProvider — fail-fast on empty baseUrl (SEV-0 defense in depth)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.OLLAMA_BASE_URL;
    delete process.env.OLLAMA_CHAT_MODEL;
    delete process.env.OLLAMA_MODEL;
    delete process.env.OLLAMA_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  test('createCompletion rejects synchronously when baseUrl is empty (no 30s hang)', async () => {
    const provider = new OllamaProvider(noopLogger, { baseUrl: '', healthCheckModel: 'whatever' });

    const start = Date.now();
    let caught: Error | null = null;

    try {
      await provider.createCompletion({
        model: 'gpt-oss:20b',
        messages: [{ role: 'user', content: 'hello' }],
      } as any);
    } catch (e) {
      caught = e as Error;
    }

    const elapsedMs = Date.now() - start;

    // Must throw (not hang).
    expect(caught).not.toBeNull();
    // Must throw FAST — well under any provider-failover budget. 200ms is
    // generous; realistic value is ~1-2ms after the fix.
    expect(elapsedMs).toBeLessThan(200);
    // Error message must mention baseUrl so operators know what to fix.
    expect(caught!.message.toLowerCase()).toContain('baseurl');
  });
});
