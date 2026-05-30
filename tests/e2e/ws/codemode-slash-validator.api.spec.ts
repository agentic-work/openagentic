/**
 * Phase 7 — WS-level slash command validator harness.
 *
 * Talks DIRECTLY to the codemode WebSocket (no browser) using the `ws`
 * package from the monorepo root. Each non-destructive slash command gets its
 * own Playwright test so per-command pass/fail appears in the report.
 *
 * Auth: reads `.auth/user.json` (populated by auth.setup.ts). Extracts the
 * `openagentic_token` cookie which the relay accepts as the `?token=` query
 * param. If the file is missing or the token is expired, the suite skips with
 * a clear message.
 *
 * WS endpoint: wss://chat.example.com/api/code/v2/ws/chat
 *   ?sessionId=<any unique string>  &token=<jwt>
 *
 * Frame sent to trigger a command:
 *   { "type": "user", "message": { "role": "user", "content": "/help" } }
 *
 * Success criteria per command (result frame must arrive within 10 s):
 *   result.type === 'result'
 *   result.subtype === 'success'
 *   result.is_error === false
 *   No 'error' type frame appeared on the connection before the result.
 *
 * Failures written to: tests/e2e/.evidence/slash-validator-failures.json
 *
 * Discovery note (2026-04-30 probe): system/init.slash_commands is present but
 * empty in remote-session mode. Spec always uses the hard-coded fallback list.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { WebSocket } from 'ws';

// __dirname is injected by Playwright's esbuild transform (CJS-compat shim).
// Do NOT add import.meta.url — it conflicts with the shim and breaks compilation.

// ────────────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────────────

const BASE_URL = (process.env.BASE_URL || 'https://chat.example.com').replace(/\/$/, '');
const WS_ENDPOINT =
  BASE_URL.replace(/^http(s?):\/\//, (_m, s) => (s === 's' ? 'wss://' : 'ws://')) +
  '/api/code/v2/ws/chat';

const AUTH_FILE = path.join(__dirname, '../../../.auth/user.json');
const EVIDENCE_DIR = path.join(__dirname, '../.evidence');

// ── Skip list — these are intercepted locally or are interactive/destructive ─
const SKIP_COMMANDS = new Set(['/exit', '/logout', '/clear', '/btw', '/login']);

// ── Hard-coded fallback (system/init.slash_commands is empty in remote mode) ─
const FALLBACK_COMMANDS: string[] = [
  '/help',
  '/agents',
  '/skills',
  '/mcp',
  '/status',
  '/cost',
  '/config',
  '/context',
  '/permissions',
  '/theme',
  '/plan',
  '/remote-control',
  '/resume',
  '/model',
  '/compact',
];

const CMD_TIMEOUT_MS = 10_000;

// ────────────────────────────────────────────────────────────────────────────
// Auth
// ────────────────────────────────────────────────────────────────────────────

interface AuthState {
  cookies: Array<{ name: string; value: string; expires?: number }>;
}

type AuthResult = { token: string } | { skip: string };

function loadAuthToken(): AuthResult {
  if (!fs.existsSync(AUTH_FILE)) {
    return {
      skip: `.auth/user.json not found — run: npx playwright test --project=auth-setup first`,
    };
  }
  let state: AuthState;
  try {
    state = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')) as AuthState;
  } catch {
    return { skip: `.auth/user.json is unreadable or invalid JSON` };
  }
  const cookie = state.cookies?.find((c) => c.name === 'openagentic_token');
  if (!cookie) {
    return { skip: `openagentic_token cookie not found in .auth/user.json — re-run auth-setup` };
  }
  if (cookie.expires && cookie.expires < Date.now() / 1000) {
    return {
      skip:
        `openagentic_token expired at ${new Date(cookie.expires * 1000).toISOString()} — ` +
        `re-run auth-setup or refresh the token via the JWT_SECRET mint procedure`,
    };
  }
  return { token: cookie.value };
}

// ────────────────────────────────────────────────────────────────────────────
// WS runner
// ────────────────────────────────────────────────────────────────────────────

interface WsFrame {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  [key: string]: unknown;
}

/**
 * Open a fresh WebSocket, wait for the first frame from the daemon (pod
 * connection confirmed), send the slash command, then collect frames until
 * a `result` frame arrives or the hard timeout fires.
 */
function runSlashCommand(cmd: string, token: string): Promise<WsFrame[]> {
  return new Promise((resolve) => {
    const sessionId =
      `sv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const url =
      `${WS_ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}` +
      `&token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(url, { rejectUnauthorized: false });
    const frames: WsFrame[] = [];
    let cmdSent = false;
    let done = false;

    function finish() {
      if (done) return;
      done = true;
      clearTimeout(hardTimeout);
      try { ws.close(); } catch { /* tolerant */ }
      resolve(frames);
    }

    const hardTimeout = setTimeout(finish, CMD_TIMEOUT_MS);

    ws.on('message', (data: Buffer | string) => {
      const text = typeof data === 'string' ? data : data.toString('utf8');
      // The relay emits one JSON object per message, but guard against NDJSON.
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let parsed: WsFrame;
        try { parsed = JSON.parse(trimmed) as WsFrame; }
        catch { parsed = { type: '_parse_error', raw: trimmed } as WsFrame; }
        frames.push(parsed);

        // Send the slash ONLY after system/init — that's when the daemon is
        // connected and ready to accept commands. Sending earlier (on
        // system/provisioning) buffers the frame in the relay but the buffer
        // flush only fires on the NEXT incoming browser message, so a sole
        // buffered slash never reaches the daemon. system/init is the first
        // frame the daemon itself emits after the relay's pod-connect succeeds.
        if (!cmdSent && parsed.type === 'system' && parsed.subtype === 'init') {
          cmdSent = true;
          const envelope = JSON.stringify({
            type: 'user',
            message: { role: 'user', content: cmd },
          });
          try { ws.send(envelope); } catch { finish(); }
        }

        if (parsed.type === 'result') { finish(); return; }
      }
    });

    ws.on('error', (err: Error) => {
      frames.push({ type: '_ws_error', message: err.message } as WsFrame);
      finish();
    });

    ws.on('close', (code: number, reason: Buffer) => {
      frames.push({
        type: '_ws_close',
        code,
        reason: reason ? reason.toString() : '',
      } as WsFrame);
      finish();
    });
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Failure artifact
// ────────────────────────────────────────────────────────────────────────────

interface FailureRecord {
  cmd: string;
  error: string;
  lastFrame: WsFrame | null;
}

const failures: FailureRecord[] = [];

function recordFailure(cmd: string, error: string, frames: WsFrame[]) {
  failures.push({ cmd, error, lastFrame: frames[frames.length - 1] ?? null });
}

function flushFailures() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(EVIDENCE_DIR, 'slash-validator-failures.json'),
    JSON.stringify(failures, null, 2),
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Module-level auth gate
// ────────────────────────────────────────────────────────────────────────────

const authResult = loadAuthToken();
const AUTH_TOKEN = 'token' in authResult ? authResult.token : null;
const AUTH_SKIP_REASON = 'skip' in authResult ? authResult.skip : null;

// Commands to run (filter out destructive ones).
const COMMANDS = FALLBACK_COMMANDS.filter((c) => !SKIP_COMMANDS.has(c));

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

test.describe('codemode slash validator — WS-level', () => {
  test.afterAll(() => {
    flushFailures();
  });

  for (const cmd of COMMANDS) {
    test(`slash: ${cmd}`, async () => {
      if (AUTH_SKIP_REASON) {
        test.skip(true, AUTH_SKIP_REASON);
        return;
      }

      const frames = await runSlashCommand(cmd, AUTH_TOKEN!);

      const resultFrame = frames.find((f) => f.type === 'result');
      const errorFrame = frames.find((f) => f.type === 'error');

      if (errorFrame) {
        const msg = `'error' frame arrived before result: ${JSON.stringify(errorFrame).slice(0, 300)}`;
        recordFailure(cmd, msg, frames);
        // Use expect.soft so remaining commands still run.
        expect.soft(false, msg).toBe(true);
        return;
      }

      if (!resultFrame) {
        const frameTypes = frames.map((f) => f.type ?? '?').join(', ');
        const msg = `no result frame within ${CMD_TIMEOUT_MS}ms — frame types: [${frameTypes}]`;
        recordFailure(cmd, msg, frames);
        expect(resultFrame, msg).toBeDefined();
        return;
      }

      if (
        resultFrame.type !== 'result' ||
        resultFrame.subtype !== 'success' ||
        resultFrame.is_error !== false
      ) {
        const msg = `unexpected result frame shape: ${JSON.stringify(resultFrame).slice(0, 300)}`;
        recordFailure(cmd, msg, frames);
      }

      expect(resultFrame.type, `${cmd}: result.type`).toBe('result');
      expect(resultFrame.subtype, `${cmd}: result.subtype`).toBe('success');
      expect(resultFrame.is_error, `${cmd}: result.is_error`).toBe(false);
    });
  }
});
