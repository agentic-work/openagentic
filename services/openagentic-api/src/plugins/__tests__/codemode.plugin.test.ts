/**
 * codemode.plugin.test.ts — Task 2.5 TDD
 *
 * Spin up an isolated Fastify instance, register codemodeRoutesPlugin, and assert:
 *
 * (A) POST /api/code/sessions is mounted (NOT 404).
 *     Without a valid token it returns 401 (auth), NOT 402 (enterprise gate).
 *     This proves the feature is free (no enterpriseOnly applied).
 *
 * (B) Source-level pin: the plugin source does NOT contain the string
 *     "enterpriseOnly" — regression guard for the free-gate decision.
 *
 * Bun/vitest-compat notes (from the original Phase 3.8 stub):
 *  - Logger inoculation mock MUST be declared before any dynamic import.
 *  - Dynamic import of codemodeRoutesPlugin happens inside beforeAll AFTER
 *    stubs are in place.
 *  - @fastify/websocket must be registered before the plugin (the plugin
 *    registers a WS route).
 *  - WS routes: inject() returns 404 in test runtime due to the Bun
 *    raw.writableEnded quirk; WS proxy logic is tested in terminal-ws.route.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { createLoggerMock } from '../../test/mocks/logger.js';

// ---------------------------------------------------------------------------
// Logger stub — MUST be declared before any dynamic import (lessons 12, 13)
// ---------------------------------------------------------------------------

vi.mock('../../utils/logger.js', () => createLoggerMock());

// ---------------------------------------------------------------------------
// Stub deps to satisfy plugin instantiation without real services
// ---------------------------------------------------------------------------

const stubExecClient = {
  createSession: vi.fn().mockResolvedValue({
    sessionId: 'stub-session',
    status: 'running',
    workspacePath: '/workspaces/stub',
    pid: 1,
    createdAt: Date.now(),
  }),
  getSession: vi.fn().mockResolvedValue({ sessionId: 'stub-session', status: 'running' }),
  stopSession: vi.fn().mockResolvedValue(undefined),
  resize: vi.fn().mockResolvedValue(undefined),
};

const stubCodeModeSettings = {
  getCodeModeSettings: vi.fn().mockResolvedValue({}),
  setCodeModeSettings: vi.fn().mockResolvedValue(undefined),
};

// validateToken stub — always invalid so auth tests work without a real JWT
const stubValidateToken = vi.fn().mockResolvedValue({ ok: false, user: null });

// connectExec stub — returns a dead WS object so the plugin registers but no
// real connection is made during tests
function stubConnectExec(_url: string, _headers: Record<string, string>): any {
  const { EventEmitter } = require('events');
  const sock = new EventEmitter() as any;
  sock.readyState = 3; // CLOSED
  sock.send = vi.fn();
  sock.close = vi.fn();
  return sock;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('codemodeRoutesPlugin — Task 2.5 smoke tests', () => {
  let app: FastifyInstance;
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    // Save env
    savedEnv.JWT_SECRET = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'test-jwt-secret-codemode-plugin-task25';

    // Build Fastify with WS support
    app = Fastify({ logger: false });
    await app.register(websocketPlugin);

    // Dynamic import AFTER stubs are in place (lesson 2)
    const { codemodeRoutesPlugin } = await import('../codemode.plugin.js');

    await app.register(codemodeRoutesPlugin, {
      execClient: stubExecClient,
      codeModeSettings: stubCodeModeSettings,
      validateToken: stubValidateToken,
      connectExec: stubConnectExec,
      codeExecWsUrl: 'ws://stub-exec:3060',
      codeExecInternalKey: 'stub-key',
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    // Restore env
    if (savedEnv.JWT_SECRET === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = savedEnv.JWT_SECRET;
  });

  // ── (A) Route mount + 401 (not 402) ─────────────────────────────────────

  it('POST /api/code/sessions is mounted (not 404)', async () => {
    const resp = await app.inject({ method: 'POST', url: '/api/code/sessions', payload: {} });
    expect(resp.statusCode).not.toBe(404);
  });

  it('POST /api/code/sessions returns 401 (auth required), NOT 402 (no enterprise gate)', async () => {
    const resp = await app.inject({ method: 'POST', url: '/api/code/sessions', payload: {} });
    // Must be 401 (no auth token) — never 402 (enterprise paywall)
    expect(resp.statusCode).toBe(401);
    expect(resp.statusCode).not.toBe(402);
  });

  // ── (B) Source-level regression guard ───────────────────────────────────

  it('codemode.plugin.ts source does NOT contain "enterpriseOnly"', () => {
    const pluginPath = resolve(__dirname, '../codemode.plugin.ts');
    let src: string;
    try {
      src = readFileSync(pluginPath, 'utf-8');
    } catch {
      // If .ts isn't readable (compiled only), try the .js
      const jsPath = resolve(__dirname, '../../plugins/codemode.plugin.js');
      src = readFileSync(jsPath, 'utf-8');
    }
    expect(src).not.toContain('enterpriseOnly');
  });

  // ── WS routes: behaviour tested in terminal-ws.route.test.ts ─────────────

  it.todo(
    'GET /api/code/ws/terminal — WS upgrade behaviour tested in terminal-ws.route.test.ts. ' +
    'inject() cannot upgrade to WS in vitest runner (raw.writableEnded quirk).',
  );
});
