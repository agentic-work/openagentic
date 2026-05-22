/**
 * Phase 3.10 source-regression test — misc routes plugin extraction.
 *
 * Asserts that after Phase 3.10:
 *  1. server.ts does NOT inline-register any of the 15 misc route groups.
 *  2. server.ts does NOT dynamically import misc route modules directly
 *     (those imports must live inside misc.plugin.ts).
 *  3. server.ts DOES contain `register(miscRoutesPlugin` (the call site).
 *  4. server.ts DOES import miscRoutesPlugin from plugins/misc.plugin.js.
 *
 * Route groups asserted absent from server.ts:
 *  - settingsRoutes (static import moved to plugin)
 *  - versionRoutes (dynamic import moved to plugin)
 *  - feedbackRoutes (dynamic import + authMiddleware wrapper moved to plugin)
 *  - openaiCompatibleRoutes (dynamic import + authMiddleware wrapper moved)
 *  - adminApiTokenRoutes (dynamic import + adminMiddleware wrapper moved)
 *  - adminWorkflowRoutes (dynamic import + adminMiddleware wrapper moved)
 *  - adminAgentRoutes (dynamic import + adminMiddleware wrapper moved)
 *  - adminAgentScheduleRoutes (dynamic import + adminMiddleware wrapper moved)
 *  - agentRoutes (dynamic import moved to plugin)
 *  - artifactsRoutes (dynamic import moved to plugin)
 *  - userSettingsRoutes (dynamic import moved to plugin)
 *  - formattingRoutes (dynamic import moved to plugin)
 *  - renderRoutes (dynamic import moved to plugin)
 *  - agentAdminRoutes / agentic-loops (dynamic import + wrapper moved)
 *  - artifactFunctionRoutes + agentExecutionApprovalRoutes (moved together)
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

// ── Misc inline registers removed from server.ts ───────────────────────────

describe('Phase 3.10 — misc inline registers removed from server.ts', () => {
  it('server.ts does NOT contain static import of settingsRoutes (moved to misc.plugin.ts)', () => {
    expect(serverTs).not.toContain("from './routes/settings.js'");
  });

  it('server.ts does NOT dynamically import versionRoutes directly (moved to misc.plugin.ts)', () => {
    expect(serverTs).not.toMatch(/import\(['"]\.\/routes\/version\.js['"]\)/);
  });

  it('server.ts does NOT dynamically import feedbackRoutes directly (moved to misc.plugin.ts)', () => {
    expect(serverTs).not.toMatch(/import\(['"]\.\/routes\/feedback\.js['"]\)/);
  });

  it('server.ts does NOT dynamically import openai-compatible routes directly (moved to misc.plugin.ts)', () => {
    expect(serverTs).not.toMatch(/import\(['"]\.\/routes\/openai-compatible\.js['"]\)/);
  });

  it('server.ts does NOT dynamically import admin-api-tokens routes directly (moved to misc.plugin.ts)', () => {
    expect(serverTs).not.toMatch(/import\(['"]\.\/routes\/admin-api-tokens\.js['"]\)/);
  });

  it('server.ts does NOT dynamically import admin/workflows routes directly (moved to misc.plugin.ts)', () => {
    expect(serverTs).not.toMatch(/import\(['"]\.\/routes\/admin\/workflows\.js['"]\)/);
  });

  it('server.ts does NOT dynamically import admin-agents routes directly (moved to misc.plugin.ts)', () => {
    expect(serverTs).not.toMatch(/import\(['"]\.\/routes\/admin-agents\.js['"]\)/);
  });

  it('server.ts does NOT dynamically import admin-agent-schedules routes directly (moved to misc.plugin.ts)', () => {
    expect(serverTs).not.toMatch(/import\(['"]\.\/routes\/admin-agent-schedules\.js['"]\)/);
  });

  it('server.ts does NOT dynamically import agents routes directly (moved to misc.plugin.ts)', () => {
    expect(serverTs).not.toMatch(/import\(['"]\.\/routes\/agents\.js['"]\)/);
  });

  it('server.ts does NOT dynamically import artifacts routes directly (moved to misc.plugin.ts)', () => {
    expect(serverTs).not.toMatch(/import\(['"]\.\/routes\/artifacts\.js['"]\)/);
  });

  it('server.ts does NOT dynamically import user-settings routes directly (moved to misc.plugin.ts)', () => {
    expect(serverTs).not.toMatch(/import\(['"]\.\/routes\/user-settings\.js['"]\)/);
  });

  it('server.ts does NOT dynamically import formatting routes directly (moved to misc.plugin.ts)', () => {
    expect(serverTs).not.toMatch(/import\(['"]\.\/routes\/formatting\.js['"]\)/);
  });

  it('server.ts does NOT dynamically import render routes directly (moved to misc.plugin.ts)', () => {
    expect(serverTs).not.toMatch(/import\(['"]\.\/routes\/render\.js['"]\)/);
  });

  it('server.ts does NOT dynamically import agentic-loops routes directly (moved to misc.plugin.ts)', () => {
    expect(serverTs).not.toMatch(/import\(['"]\.\/routes\/admin\/agentic-loops\.js['"]\)/);
  });

  it('server.ts does NOT dynamically import artifact-functions routes directly (moved to misc.plugin.ts)', () => {
    expect(serverTs).not.toMatch(/import\(['"]\.\/routes\/artifact-functions\.js['"]\)/);
  });

  it('server.ts does NOT dynamically import embed routes directly (moved to misc.plugin.ts)', () => {
    expect(serverTs).not.toMatch(/import\(['"]\.\/routes\/embed\.js['"]\)/);
  });
});

// ── Plugin registration present in server.ts ───────────────────────────────

describe('Phase 3.10 — miscRoutesPlugin registered in server.ts', () => {
  it('server.ts DOES contain register(miscRoutesPlugin (the call site, not just the symbol)', () => {
    expect(serverTs).toContain('register(miscRoutesPlugin');
  });

  it('server.ts DOES import miscRoutesPlugin from plugins/misc.plugin.js', () => {
    expect(serverTs).toContain('misc.plugin');
  });
});
