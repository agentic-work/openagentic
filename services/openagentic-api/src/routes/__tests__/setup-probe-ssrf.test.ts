/**
 * B4 (FedRAMP P3) — POST /api/setup/probe-ollama must be setup-gated + SSRF-guarded.
 *
 * The route is intentionally unauthenticated (a fresh stack has no admin), but
 * before remediation it (a) stayed live forever — reachable as an SSRF
 * primitive long after setup — and (b) fetched an attacker-controlled `host`
 * with no validation, so `host=http://169.254.169.254` reached the cloud
 * metadata endpoint and arbitrary internal ports could be scanned.
 *
 * Required posture (NIST SC-7, AC-3, AC-4, SI-10):
 *   - once an admin exists (setup complete), the route returns 409 (dead).
 *   - the cloud-metadata IP (169.254.169.254 / fd00:ec2::254) is blocked.
 *   - non-http(s) schemes are rejected.
 *   - a normal LAN/loopback Ollama host is still allowed PRE-setup (a fresh
 *     install legitimately points at host.docker.internal / 192.168.x.x).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma so we can flip "admin exists" without a DB.
const counts = { user: 0, admin: 0, provider: 0 };
vi.mock('../../utils/prisma.js', () => ({
  prisma: {
    user: { count: vi.fn(async (args?: any) => (args?.where?.is_admin ? counts.admin : counts.user)) },
    lLMProvider: { count: vi.fn(async () => counts.provider) },
  },
}));

import Fastify from 'fastify';
import { setupRoutes } from '../setup.js';

async function build() {
  const app = Fastify();
  await app.register(setupRoutes);
  await app.ready();
  return app;
}

describe('POST /api/setup/probe-ollama — setup-gated + SSRF-guarded (B4)', () => {
  beforeEach(() => {
    counts.user = 0;
    counts.admin = 0;
    counts.provider = 0;
  });

  it('returns 409 once an admin exists (route is dead post-setup)', async () => {
    counts.user = 1;
    counts.admin = 1;
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/probe-ollama',
      payload: { host: 'http://host.docker.internal:11434' },
    });
    expect(res.statusCode).toBe(409);
    await app.close();
  });

  it('blocks the cloud-metadata IP (169.254.169.254) pre-setup', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/probe-ollama',
      payload: { host: 'http://169.254.169.254' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/blocked|not allowed|metadata|forbidden/i);
    await app.close();
  });

  it('rejects a non-http(s) scheme (file://)', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/probe-ollama',
      payload: { host: 'file:///etc/passwd' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('rejects gopher:// and other exotic schemes', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/probe-ollama',
      payload: { host: 'gopher://169.254.169.254/_' },
    });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it('allows a normal LAN host PRE-setup (does not 400/409 on validation; network failure is 502)', async () => {
    const app = await build();
    const res = await app.inject({
      method: 'POST',
      url: '/probe-ollama',
      payload: { host: 'http://192.168.1.50:11434' },
    });
    // Validation passes (not 400/409). The actual fetch will fail in the test
    // env → 502. The point: a legit LAN Ollama is NOT blocked by the guard.
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(409);
    await app.close();
  });
});
