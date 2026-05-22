/**
 * Phase 3.8 source-regression test — codemode domain routes extraction.
 *
 * Asserts that after Phase 3.8:
 *  1. server.ts does NOT contain inline WebSocket handler registrations for
 *     the 4 codemode WS routes (terminal, progress, events, chat).
 *  2. server.ts does NOT contain inline registrations for code routes block
 *     (code.js, code-plugins.js, code-mode-provisioning.js).
 *  3. server.ts does NOT contain the inline /api/code/ws/resolve handler.
 *  4. server.ts does NOT contain the inline /api/admin/codemode/* block.
 *  5. server.ts does NOT contain the inline /api/admin/code/* block.
 *  6. server.ts DOES contain `register(codemodeRoutesPlugin` (call site, not
 *     bare symbol — per Phase 3.1 lesson #1: assert the call site).
 *  7. server.ts DOES import codemodeRoutesPlugin from plugins/codemode.plugin.js
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

// ── Code routes block removed from server.ts ─────────────────────────────────

describe('Phase 3.8 — code routes block removed from server.ts', () => {
  it('server.ts does NOT inline-import routes/code.js (moved to codemode.plugin.ts)', () => {
    // The dynamic import should be gone; the plugin handles it internally.
    expect(serverTs).not.toContain("routes/code.js'");
    expect(serverTs).not.toContain('routes/code.js"');
    expect(serverTs).not.toMatch(/const codeRoutes\s*=\s*\(await import/);
  });

  it('server.ts does NOT inline-import routes/code-plugins.js (moved to codemode.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/code-plugins.js'");
    expect(serverTs).not.toContain('routes/code-plugins.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*codePluginsRoutes\s*\}/);
  });

  it('server.ts does NOT inline-import routes/code-mode-provisioning.js (moved to codemode.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/code-mode-provisioning.js'");
    expect(serverTs).not.toContain('routes/code-mode-provisioning.js"');
    expect(serverTs).not.toMatch(/const\s*\{\s*default:\s*codeModeProvisioningRoutes\s*\}/);
  });
});

// ── WS handlers removed from server.ts ──────────────────────────────────────

describe('Phase 3.8 — inline WS handlers removed from server.ts', () => {
  it("server.ts does NOT register inline /api/code/ws/terminal (moved to code-ws/terminal.ts)", () => {
    expect(serverTs).not.toMatch(/server\.get\(['"`]\/api\/code\/ws\/terminal/);
  });

  it("server.ts does NOT register inline /api/code/ws/progress (moved to code-ws/progress.ts)", () => {
    expect(serverTs).not.toMatch(/server\.get\(['"`]\/api\/code\/ws\/progress/);
  });

  it("server.ts does NOT register inline /api/code/ws/events (moved to code-ws/events.ts)", () => {
    expect(serverTs).not.toMatch(/server\.get\(['"`]\/api\/code\/ws\/events/);
  });

  it("server.ts does NOT register inline /api/code/ws/chat (moved to code-ws/chat.ts)", () => {
    expect(serverTs).not.toMatch(/server\.get\(['"`]\/api\/code\/ws\/chat/);
  });

  it("server.ts does NOT register inline /api/code/ws/resolve handler (moved to codemode.plugin.ts)", () => {
    expect(serverTs).not.toMatch(/server\.get\(['"`]\/api\/code\/ws\/resolve/);
  });
});

// ── Admin code routes removed from server.ts ────────────────────────────────

describe('Phase 3.8 — admin code routes removed from server.ts', () => {
  it('server.ts does NOT inline-import routes/admin-code.js (moved to codemode.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin-code.js'");
    expect(serverTs).not.toContain('routes/admin-code.js"');
    expect(serverTs).not.toMatch(/const adminCodeRoutes\s*=\s*\(await import/);
  });

  it('server.ts does NOT inline-import routes/admin/codemode.js (moved to codemode.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/admin/codemode.js'");
    expect(serverTs).not.toContain('routes/admin/codemode.js"');
    expect(serverTs).not.toMatch(/const codemodeAdminRoutes\s*=\s*\(await import/);
  });

  it('server.ts does NOT inline-register /api/admin/codemode/config-bundle-internal (moved to codemode.plugin.ts)', () => {
    expect(serverTs).not.toMatch(/server\.get\(['"`]\/api\/admin\/codemode\/config-bundle-internal/);
  });
});

// ── CCR dual-mount removed from server.ts ───────────────────────────────────

describe('Phase 3.8 — CCR dual-mount logic removed from server.ts', () => {
  it('server.ts does NOT contain inline ccrRelayEnabled variable declaration (moved to codemode.plugin.ts)', () => {
    expect(serverTs).not.toMatch(/const ccrRelayEnabled\s*=/);
  });

  it('server.ts does NOT inline-import routes/code-mode/relay-ws.handler.js (moved to codemode.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/code-mode/relay-ws.handler.js'");
    expect(serverTs).not.toContain('routes/code-mode/relay-ws.handler.js"');
  });

  it('server.ts does NOT inline-import routes/code-mode/chat-stream.handler.js (moved to codemode.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/code-mode/chat-stream.handler.js'");
    expect(serverTs).not.toContain('routes/code-mode/chat-stream.handler.js"');
  });

  it('server.ts does NOT inline-import routes/code-mode/boot-events.handler.js (moved to codemode.plugin.ts)', () => {
    expect(serverTs).not.toContain("routes/code-mode/boot-events.handler.js'");
    expect(serverTs).not.toContain('routes/code-mode/boot-events.handler.js"');
  });
});

// ── Plugin registration present in server.ts ────────────────────────────────

describe('Phase 3.8 — codemodeRoutesPlugin registered in server.ts', () => {
  it('server.ts DOES contain register(codemodeRoutesPlugin (the call site, not just symbol)', () => {
    // Lock the actual register call site per Phase 3.1 lesson #1:
    // a bare-symbol assertion passes against a comment and gives false positives.
    expect(serverTs).toContain('register(codemodeRoutesPlugin');
  });

  it('server.ts DOES import codemodeRoutesPlugin from plugins/codemode.plugin.js', () => {
    expect(serverTs).toContain('codemode.plugin');
  });
});
