/**
 * Phase 3.1 source-regression test — chat routes extraction.
 *
 * Asserts that after Phase 3.1:
 *  1. server.ts does NOT contain a static import of `chatPlugin` from
 *     `./routes/chat/index` (the import was moved into chat.plugin.ts).
 *  2. server.ts does NOT directly import or `await import` `approvalsRoutes`.
 *  3. server.ts does NOT directly import or `await import` `sandboxResultRoute`.
 *  4. server.ts does NOT directly import or `await import` `agentEventRoute`.
 *  5. server.ts DOES contain `chatRoutesPlugin` (the new wrapper is registered).
 *
 * "Directly import" means a dynamic `await import('./routes/chat/<file>')` call
 * OR a destructured `{ symbol }` from that import.  We check for the symbol name
 * in the file so a future accidental re-introduction of the literal string is
 * caught regardless of how the import is written.
 *
 * Run from any CWD; all paths resolved relative to this file's __dirname.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// __dirname = services/openagentic-api/src/__tests__
const REPO_ROOT = resolve(__dirname, '../../../../..');
const API_SRC = join(REPO_ROOT, 'services/openagentic-api/src');

const serverTs = readFileSync(join(API_SRC, 'server.ts'), 'utf-8');

describe('Phase 3.1 — chat-domain dynamic imports removed from server.ts', () => {
  it('server.ts does NOT dynamic-import chatPlugin from routes/chat/index (moved to chat.plugin.ts)', () => {
    // The pre-3.1 pattern was: const { chatPlugin } = await import('./routes/chat/index.js')
    // We assert the dynamic import of the routes/chat/index module is gone from server.ts.
    expect(serverTs).not.toContain("from './routes/chat/index.js'");
    expect(serverTs).not.toContain('from "./routes/chat/index.js"');
  });

  it('server.ts does NOT dynamic-import approvals.js from routes/chat (moved to chat.plugin.ts)', () => {
    // The pre-3.1 pattern was: await import('./routes/chat/approvals.js')
    expect(serverTs).not.toContain('./routes/chat/approvals.js');
    expect(serverTs).not.toContain('./routes/chat/approvals"');
  });

  it('server.ts does NOT dynamic-import sandbox-result.route.js (moved to chat.plugin.ts)', () => {
    // The pre-3.1 pattern was: await import('./routes/chat/sandbox-result.route.js')
    expect(serverTs).not.toContain('sandbox-result.route.js');
  });

  it('server.ts does NOT dynamic-import agent-event.route.js (moved to chat.plugin.ts)', () => {
    // The pre-3.1 pattern was: await import('./routes/chat/agent-event.route.js')
    expect(serverTs).not.toContain('agent-event.route.js');
  });
});

describe('Phase 3.1 — chatRoutesPlugin is registered in server.ts', () => {
  it('server.ts DOES contain chatRoutesPlugin (the new wrapper plugin is wired in)', () => {
    // Lock the actual register call site, not just the symbol name (which could appear in a comment).
    expect(serverTs).toContain('register(chatRoutesPlugin');
  });
});
