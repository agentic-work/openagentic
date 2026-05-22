/**
 * SEV-0 (2026-05-12 live capture from the dev environment kubectl logs):
 *
 *   {"service":"ChatMCPService","userId":"<real-user-id>","msg":"listTools called - fetching tools from MCP Proxy"}
 *   {"service":"ChatMCPService","status":401,"msg":"Failed to fetch tools from MCP Proxy"}
 *   {"name":"chat-api","userId":"<real-user-id>","listMcpToolsCount":0,"msg":"[STREAM] V2 mcpTools loaded"}
 *
 * Root cause: `ChatMCPService.listTools(authHeader, userId)` accepts the
 * auth params at the method signature (line 188) but the fetch at
 * `ChatMCPService.ts:197` is `fetch(${mcpProxyUrl}/tools)` — NO
 * Authorization header is passed. The MCP proxy rejects with 401.
 *
 * Downstream impact: the model gets only the 9 meta-tools surface — every
 * MCP tool the user expected `tool_search` to find is missing because
 * the T2 catalog never loads. User-facing symptom: "tools don't work."
 *
 * Fix contract:
 *  - When `authHeader` is provided, forward it verbatim as the
 *    `Authorization` header on the `/tools` GET.
 *  - When `authHeader` is absent (system / startup calls), sign an
 *    internal HS256 JWT via the same JWT_SECRET path that
 *    `buildMcpProxyHeaders` uses for non-Azure callers — the MCP proxy
 *    validates both shapes.
 *  - When neither is available, fall back to `API_INTERNAL_KEY`
 *    service-to-service token (last-ditch — better than naked fetch).
 *
 * TDD-RED before fix.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChatMCPService } from '../ChatMCPService.js';

const makeLogger = () => {
  const child = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: (() => child) as any,
  };
  return child as any;
};

describe('ChatMCPService.listTools — SEV-0 auth-header pass-through (2026-05-12)', () => {
  let originalFetch: any;
  let originalEnv: Record<string, string | undefined>;
  let captured: { url: string; init?: RequestInit }[];

  beforeEach(() => {
    captured = [];
    originalFetch = globalThis.fetch;
    originalEnv = {
      MCP_PROXY_URL: process.env.MCP_PROXY_URL,
      JWT_SECRET: process.env.JWT_SECRET,
      SIGNING_SECRET: process.env.SIGNING_SECRET,
      API_INTERNAL_KEY: process.env.API_INTERNAL_KEY,
    };
    process.env.MCP_PROXY_URL = 'http://mcp-proxy:8080';
    globalThis.fetch = vi.fn(async (url: any, init?: RequestInit) => {
      captured.push({ url: String(url), init });
      return new Response(JSON.stringify({ tools: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as any;
  });

  const restoreEnv = () => {
    globalThis.fetch = originalFetch;
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete (process.env as any)[k];
      else (process.env as any)[k] = v;
    }
  };

  it('forwards the provided authHeader verbatim as Authorization', async () => {
    const svc = new ChatMCPService(makeLogger());
    const bearer = 'Bearer eyJhbGc.fake.payload';
    try {
      await svc.listTools(bearer, 'user-123');
      expect(captured.length).toBeGreaterThan(0);
      const call = captured[0];
      expect(call.url).toContain('/tools');
      const headers = new Headers(call.init?.headers as any);
      expect(headers.get('Authorization')).toBe(bearer);
    } finally {
      restoreEnv();
    }
  });

  it('falls back to internal HS256 JWT when no authHeader (system call)', async () => {
    process.env.JWT_SECRET = 'test-secret-only';
    const svc = new ChatMCPService(makeLogger());
    try {
      await svc.listTools(undefined, 'system');
      expect(captured.length).toBeGreaterThan(0);
      const headers = new Headers(captured[0].init?.headers as any);
      const auth = headers.get('Authorization');
      expect(auth, 'must set SOME Authorization header even without inbound bearer').toBeTruthy();
      expect(auth!.startsWith('Bearer '), 'header is Bearer-shaped').toBe(true);
      // Sanity: not a naked empty bearer.
      expect(auth!.slice(7).length).toBeGreaterThan(20);
    } finally {
      restoreEnv();
    }
  });

  it('falls back to API_INTERNAL_KEY when neither authHeader nor JWT_SECRET set', async () => {
    delete process.env.JWT_SECRET;
    delete process.env.SIGNING_SECRET;
    process.env.API_INTERNAL_KEY = 'sk-internal-test-key';
    const svc = new ChatMCPService(makeLogger());
    try {
      await svc.listTools(undefined, undefined);
      expect(captured.length).toBeGreaterThan(0);
      const headers = new Headers(captured[0].init?.headers as any);
      expect(headers.get('Authorization')).toBe('Bearer sk-internal-test-key');
    } finally {
      restoreEnv();
    }
  });

  it('never makes the request with zero auth header (regression guard)', async () => {
    delete process.env.JWT_SECRET;
    delete process.env.SIGNING_SECRET;
    delete process.env.API_INTERNAL_KEY;
    const svc = new ChatMCPService(makeLogger());
    try {
      await svc.listTools(undefined, undefined);
      // Even with no creds available, the request should either:
      //   (a) carry SOME Authorization header (best-effort empty bearer), OR
      //   (b) not have been made at all (defensive short-circuit).
      // What MUST NOT happen: fetch the /tools endpoint with no Authorization
      // header at all — that's the 2026-05-12 regression.
      if (captured.length > 0) {
        const headers = new Headers(captured[0].init?.headers as any);
        expect(headers.has('Authorization')).toBe(true);
      }
    } finally {
      restoreEnv();
    }
  });
});
