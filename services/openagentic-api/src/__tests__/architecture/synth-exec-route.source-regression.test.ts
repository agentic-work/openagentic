/**
 * #482 — same-origin /api/synth/exec route for T3 compose_app iframe
 * direct Python execution.
 *
 * Plan: /home/trent/.claude/plans/sprightly-percolating-brook.md
 *
 * Architecture:
 *   AppRenderer iframe srcdoc emits `fetch('/api/synth/exec', {method:'POST', body:{code}})`.
 *   The UI nginx routes /api/* to the api pod. The api's `/api/synth/*` plugin
 *   has the `unifiedAuth` middleware (AAD JWT cookie) AND a preHandler that
 *   calls AzureOBOService to inject ARM + Graph tokens onto request.cloudCredentials.
 *   The new POST /exec handler delegates to SynthService.executeCode which
 *   forwards to the synth-executor with those credentials in env — so the
 *   Python code runs as the AD user with their cloud permissions.
 *
 * THESE TESTS ARE SOURCE-GREP regressions because the chain spans three files
 * (route → service → executor client) and is the load-bearing wiring that
 * the MVP T3 mini-apps depend on.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const SYNTH_ROUTE_PATH = path.resolve(__dirname, '../../routes/synth.ts');
const SYNTH_SERVICE_PATH = path.resolve(__dirname, '../../services/SynthService.ts');

function read(p: string): string {
  return readFileSync(p, 'utf8');
}

describe('#482 /api/synth/exec — auth-injected raw code execution', () => {
  it('synth.ts registers POST /exec', () => {
    const src = read(SYNTH_ROUTE_PATH);
    // Match either fastify.post('/exec', ...) or fastify.post(`/exec`, ...).
    expect(src).toMatch(/fastify\.post\(\s*['"`]\/exec['"`]/);
  });

  it('POST /exec rejects unauthenticated requests with 401', () => {
    const src = read(SYNTH_ROUTE_PATH);
    // The handler must check `request.user` and 401 when missing — same
    // pattern as /synthesize. Without this, the OBO preHandler silently
    // skips and the executor runs with NO user context — privilege loss.
    const execHandler = src.match(/fastify\.post\(\s*['"`]\/exec['"`][\s\S]+?\n  \}\);/);
    expect(execHandler).not.toBeNull();
    expect(execHandler![0]).toMatch(/if\s*\(!user\)[\s\S]{0,80}reply\.code\(401\)/);
  });

  // #484 C4 — unifiedAuth populates request.user for internal-service callers
  // (those presenting x-request-from + x-internal-secret) with
  // `accessToken === 'internal-service-token'` and id starting with 'service-'.
  // The OBO preHandler skips these (correctly — no user token to exchange),
  // but `if (!user)` still passes — net effect is Python runs in synth-executor
  // sandbox with NO user identity, NO OBO creds, AS the executor service account.
  // Violates the user's "AD user must flow through" demand.
  it('POST /exec rejects internal-service tokens with 403', () => {
    const src = read(SYNTH_ROUTE_PATH);
    const execHandler = src.match(/fastify\.post\(\s*['"`]\/exec['"`][\s\S]+?\n  \}\);/);
    expect(execHandler).not.toBeNull();
    // Must check accessToken !== 'internal-service-token' OR id NOT starting
    // with 'service-' OR similar gate that rejects the service-principal shape.
    expect(execHandler![0]).toMatch(/internal-service-token|service-/);
    expect(execHandler![0]).toMatch(/reply\.code\(403\)/);
  });

  it('POST /exec passes request.cloudCredentials through to SynthService.executeCode', () => {
    const src = read(SYNTH_ROUTE_PATH);
    const execHandler = src.match(/fastify\.post\(\s*['"`]\/exec['"`][\s\S]+?\n  \}\);/);
    expect(execHandler).not.toBeNull();
    // The OBO preHandler stamps request.cloudCredentials. The handler must
    // forward this, not silently drop it (which would mean code runs as the
    // anonymous synth-executor service account instead of the user).
    expect(execHandler![0]).toMatch(/cloudCredentials/);
    expect(execHandler![0]).toMatch(/synthService\.executeCode|executeCode\(/);
  });

  it('SynthService exposes a public executeCode method', () => {
    const src = read(SYNTH_SERVICE_PATH);
    // Public method name is exact — the route imports against the type.
    expect(src).toMatch(/(?:async\s+|public\s+async\s+)executeCode\s*\(/);
  });

  it('SynthService.executeCode forwards credentials + capabilities to the executor', () => {
    const src = read(SYNTH_SERVICE_PATH);
    // Match from `executeCode(` until the next top-level method declaration
    // so the body span includes the executor.execute() call further down.
    const methodBody = src.match(/(?:async\s+|public\s+async\s+)executeCode\s*\([\s\S]+?(?=\n  (?:private|public|async)\s|\n\}\n)/);
    expect(methodBody).not.toBeNull();
    expect(methodBody![0]).toMatch(/this\.executorClient\.execute/);
    expect(methodBody![0]).toMatch(/credentials/);
  });
});
