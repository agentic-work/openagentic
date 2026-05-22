/**
 * Pin: rateLimitOptions.skip exempts internal-service callers (openagentic-proxy,
 * mcp-proxy, workflows) from the per-IP rate limit.
 *
 * Why: openagentic-proxy fans out dozens of api calls per multi_agent run (agent
 * config resolution, mcp tool list, execution persistence). The per-IP
 * 100/min budget treats openagentic-proxy as a single user and 429-storms the
 * whole multi_agent flow. Once we authenticate openagentic-proxy via X-Request-From
 * + INTERNAL_SERVICE_SECRET (in middleware/unifiedAuth.ts), the rate limiter
 * doesn't need to additionally throttle them — they're already a trusted
 * service principal. This pin documents the carve-out so future changes to
 * security.ts don't accidentally re-introduce the storm.
 */

import { describe, it, expect, beforeAll } from 'vitest';

let rateLimitOptions: any;

beforeAll(async () => {
  // security.ts validates env at import time — set fakes before dynamic import.
  process.env.API_SECRET_KEY = process.env.API_SECRET_KEY || 'test-api-secret';
  process.env.FRONTEND_SECRET = process.env.FRONTEND_SECRET || 'test-frontend-secret';
  process.env.SIGNING_SECRET = process.env.SIGNING_SECRET || 'test-signing-secret';
  ({ rateLimitOptions } = await import('../security.js'));
});

const fakeReq = (headers: Record<string, string>) =>
  ({ headers, ip: '10.42.6.176', url: '/api/agents/resolve' } as any);

describe('rateLimitOptions.skip — internal service exemption', () => {
  it('skips openagentic-proxy', () => {
    expect(rateLimitOptions.skip(fakeReq({ 'x-request-from': 'openagentic-proxy' }))).toBe(true);
  });

  it('skips mcp-proxy', () => {
    expect(rateLimitOptions.skip(fakeReq({ 'x-request-from': 'mcp-proxy' }))).toBe(true);
  });

  it('skips workflows', () => {
    expect(rateLimitOptions.skip(fakeReq({ 'x-request-from': 'workflows' }))).toBe(true);
  });

  it('skips literal "internal"', () => {
    expect(rateLimitOptions.skip(fakeReq({ 'x-request-from': 'internal' }))).toBe(true);
  });

  it('case-insensitive', () => {
    expect(rateLimitOptions.skip(fakeReq({ 'x-request-from': 'AGENT-PROXY' }))).toBe(true);
  });

  it('does NOT skip browser callers (no x-request-from)', () => {
    expect(rateLimitOptions.skip(fakeReq({}))).toBe(false);
  });

  it('does NOT skip arbitrary unrecognized values', () => {
    expect(rateLimitOptions.skip(fakeReq({ 'x-request-from': 'attacker' }))).toBe(false);
  });
});
