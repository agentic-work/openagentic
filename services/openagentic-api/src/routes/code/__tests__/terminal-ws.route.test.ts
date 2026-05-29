/**
 * terminal-ws.route.test.ts — Task 2.4 TDD
 *
 * Tests for the /ws/terminal WebSocket proxy route.
 *
 * Strategy:
 *  - Spin up a tiny in-process ws echo server as the fake exec backend.
 *  - Inject `connectExec` and `validateToken` via plugin opts so no real
 *    deps are loaded.
 *  - Use `fastify.injectWS()` (provided by @fastify/websocket v11) to open
 *    a client connection without needing a real TCP port.
 *
 * Assertions:
 *  (a) bytes client → exec are received by fake exec
 *  (b) bytes exec → client are received by the client
 *  (c) fake exec received the x-internal-api-key header on upgrade
 *  (d) invalid token → socket closed with code 1008
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import websocketPlugin from '@fastify/websocket';
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';
import { codeTerminalWsRoute } from '../terminal-ws.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) { resolve(); return; }
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<Buffer | string> {
  return new Promise((resolve, reject) => {
    ws.once('message', (data) => resolve(data as Buffer | string));
    ws.once('error', reject);
  });
}

function waitForClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.once('close', (code, reason) => resolve({ code, reason: reason?.toString() ?? '' }));
  });
}

// ---------------------------------------------------------------------------
// Fake exec WebSocket server
// ---------------------------------------------------------------------------

let fakeExecServer: WebSocketServer;
let fakeExecHttpServer: http.Server;
let fakeExecPort: number;

// Captured state from the fake exec server
let capturedInternalKey: string | undefined;
let fakeExecConnections: WebSocket[] = [];

async function startFakeExec(): Promise<number> {
  fakeExecHttpServer = http.createServer();
  fakeExecServer = new WebSocketServer({ server: fakeExecHttpServer });

  fakeExecServer.on('connection', (ws, req) => {
    capturedInternalKey = req.headers['x-internal-api-key'] as string | undefined;
    fakeExecConnections.push(ws);
    // Echo all messages back
    ws.on('message', (data) => {
      ws.send(data);
    });
  });

  return new Promise((resolve) => {
    fakeExecHttpServer.listen(0, '127.0.0.1', () => {
      const addr = fakeExecHttpServer.address() as { port: number };
      resolve(addr.port);
    });
  });
}

// ---------------------------------------------------------------------------
// Fastify instance with real @fastify/websocket + terminal-ws plugin
// ---------------------------------------------------------------------------

let app: FastifyInstance;
const INTERNAL_KEY = 'test-internal-key-xyz';
const VALID_USER = { id: 'u1', userId: 'u1', email: 'u1@test.com', isAdmin: false };

const stubValidateToken = vi.fn();

beforeAll(async () => {
  // 1. Start the fake exec server and get its port
  fakeExecPort = await startFakeExec();

  // 2. Build Fastify
  app = Fastify({ logger: false });
  await app.register(websocketPlugin);

  // 3. Register the terminal-ws route with injectable factories
  await app.register(codeTerminalWsRoute, {
    codeExecWsUrl: `ws://127.0.0.1:${fakeExecPort}`,
    codeExecInternalKey: INTERNAL_KEY,
    validateToken: stubValidateToken,
    connectExec: (url: string, headers: Record<string, string>) =>
      new WebSocket(url, { headers }),
  });

  await app.ready();
});

afterAll(async () => {
  fakeExecConnections.forEach((ws) => ws.terminate());
  fakeExecConnections = [];
  await app.close();
  await new Promise<void>((resolve) =>
    fakeExecServer.close(() => fakeExecHttpServer.close(() => resolve()))
  );
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /ws/terminal — token auth', () => {
  it('(d) closes with 1008 when token is missing or invalid', async () => {
    stubValidateToken.mockResolvedValueOnce({ ok: false, user: null });

    const ws = await app.injectWS('/ws/terminal?sessionId=sess1&token=bad-token');
    const { code } = await waitForClose(ws);

    // The route closes with 1008 on auth failure
    expect(code).toBe(1008);
    ws.terminate();
  });
});

describe('GET /ws/terminal — proxy behavior', () => {
  beforeAll(() => {
    // Reset captured state before proxy tests
    capturedInternalKey = undefined;
    fakeExecConnections = [];
  });

  it('(a) forwards bytes from client to exec', async () => {
    stubValidateToken.mockResolvedValue({ ok: true, user: VALID_USER });

    const sessionId = 'session-abc-123';
    const ws = await app.injectWS(`/ws/terminal?sessionId=${sessionId}&token=valid-token`);

    // Wait a tick for the outbound exec WS to connect
    await new Promise((r) => setTimeout(r, 150));

    // The fake exec echoes messages back, so send from client and expect echo
    const msgPromise = waitForMessage(ws);
    ws.send('hello from client');

    const received = await msgPromise;
    expect(received.toString()).toBe('hello from client');

    ws.terminate();
  });

  it('(b) forwards bytes from exec to client', async () => {
    stubValidateToken.mockResolvedValue({ ok: true, user: VALID_USER });

    const ws = await app.injectWS(`/ws/terminal?sessionId=sess-b&token=valid-token`);
    await new Promise((r) => setTimeout(r, 150));

    // Find the exec-side socket for this connection (last connected)
    const execWs = fakeExecConnections[fakeExecConnections.length - 1];
    expect(execWs).toBeDefined();

    const msgPromise = waitForMessage(ws);
    execWs.send('pushed from exec');

    const received = await msgPromise;
    expect(received.toString()).toBe('pushed from exec');

    ws.terminate();
  });

  it('(c) outbound exec WS upgrade includes x-internal-api-key header', async () => {
    // capturedInternalKey is set by the fake exec server on upgrade
    expect(capturedInternalKey).toBe(INTERNAL_KEY);
  });
});
