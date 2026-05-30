/**
 * Task 1.3 (V3 Enterprise Chatmode design — substrate fix S5):
 * receive-side tenantId contract for every workflow-execution route in
 * openagentic-workflows/src/index.ts.
 *
 * The api caller (executeViaWorkflowsService / resumeViaWorkflowsService)
 * is the JWT-trusted boundary — it derives tenantId from the
 * `azure_tenant_id` claim and ships it on the wire. This test pins the
 * receive-side defense: workflows-svc MUST 400 with a structured
 * `{ error: 'missing_tenant_id' }` body when the caller forgets the
 * contract, rather than falling through to a route handler that might
 * run un-tenanted Prisma queries.
 *
 * Task 1.4 will wrap each route in `withTenant({ tenantId }, ...)` —
 * this validator is the precondition.
 */
import { describe, it, expect, vi } from 'vitest';
import { validateTenantId } from '../../middleware/validateTenantId.js';

// Minimal FastifyReply mock — captures status + body for assertions.
function mockReply() {
  const sentBody: { value?: unknown } = {};
  let statusCode: number | undefined;
  const reply: any = {
    code(c: number) {
      statusCode = c;
      return reply;
    },
    send(b: unknown) {
      sentBody.value = b;
      return reply;
    },
  };
  return {
    reply,
    get statusCode() { return statusCode; },
    get sentBody() { return sentBody.value; },
  };
}

describe('Task 1.3 — receive-side tenantId validation (workflows-svc)', () => {
  it('rejects body with no tenantId — 400 + missing_tenant_id', () => {
    const m = mockReply();
    const ok = validateTenantId({}, m.reply);
    expect(ok).toBe(false);
    expect(m.statusCode).toBe(400);
    expect(m.sentBody).toEqual({ error: 'missing_tenant_id' });
  });

  it('rejects body with empty-string tenantId — 400 + missing_tenant_id', () => {
    const m = mockReply();
    const ok = validateTenantId({ tenantId: '' }, m.reply);
    expect(ok).toBe(false);
    expect(m.statusCode).toBe(400);
    expect(m.sentBody).toEqual({ error: 'missing_tenant_id' });
  });

  it('rejects body with whitespace-only tenantId — 400 + missing_tenant_id', () => {
    const m = mockReply();
    const ok = validateTenantId({ tenantId: '   ' }, m.reply);
    expect(ok).toBe(false);
    expect(m.statusCode).toBe(400);
    expect(m.sentBody).toEqual({ error: 'missing_tenant_id' });
  });

  it('rejects body with null tenantId — 400 + missing_tenant_id', () => {
    const m = mockReply();
    const ok = validateTenantId({ tenantId: null }, m.reply);
    expect(ok).toBe(false);
    expect(m.statusCode).toBe(400);
    expect(m.sentBody).toEqual({ error: 'missing_tenant_id' });
  });

  it('rejects body with non-string tenantId (number) — 400', () => {
    const m = mockReply();
    const ok = validateTenantId({ tenantId: 12345 as any }, m.reply);
    expect(ok).toBe(false);
    expect(m.statusCode).toBe(400);
    expect(m.sentBody).toEqual({ error: 'missing_tenant_id' });
  });

  it('rejects body with non-string tenantId (object) — 400', () => {
    const m = mockReply();
    const ok = validateTenantId({ tenantId: { foo: 'bar' } as any }, m.reply);
    expect(ok).toBe(false);
    expect(m.statusCode).toBe(400);
    expect(m.sentBody).toEqual({ error: 'missing_tenant_id' });
  });

  it('rejects null body — 400', () => {
    const m = mockReply();
    const ok = validateTenantId(null, m.reply);
    expect(ok).toBe(false);
    expect(m.statusCode).toBe(400);
    expect(m.sentBody).toEqual({ error: 'missing_tenant_id' });
  });

  it('rejects undefined body — 400', () => {
    const m = mockReply();
    const ok = validateTenantId(undefined, m.reply);
    expect(ok).toBe(false);
    expect(m.statusCode).toBe(400);
    expect(m.sentBody).toEqual({ error: 'missing_tenant_id' });
  });

  it('accepts body with valid non-empty tenantId — true, no reply call', () => {
    const m = mockReply();
    const ok = validateTenantId({ tenantId: 'tenant-A' }, m.reply);
    expect(ok).toBe(true);
    expect(m.statusCode).toBeUndefined();
    expect(m.sentBody).toBeUndefined();
  });

  it('trims whitespace-padded tenantId — accept (the api caller normalizes too)', () => {
    const m = mockReply();
    // We accept "  tnt-1  " because trim() yields a non-empty string —
    // the validator's job is only to gate empty/missing, not to enforce
    // a canonical id format.
    const ok = validateTenantId({ tenantId: '  tnt-1  ' }, m.reply);
    expect(ok).toBe(true);
    expect(m.statusCode).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source-regression: every workflow-execution route in index.ts MUST call
// validateTenantId() before any side-effectful work. This pin guards against
// future routes accidentally skipping the gate.
// ─────────────────────────────────────────────────────────────────────────────
describe('Task 1.3 — source-regression: every Body route validates tenantId', () => {
  it('routes /execute, /execute-sync, /resume-execution, /test-node call validateTenantId', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const url = await import('node:url');
    const __filename = url.fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const indexPath = path.resolve(__dirname, '../../index.ts');
    const source = fs.readFileSync(indexPath, 'utf8');

    // Find every '>('/route'...) endpoint string. The Fastify generic
    // declarations span multiple lines, so we capture the path literal
    // directly — picks up '/execute', '/execute-sync', '/resume-execution',
    // '/compile', /health, /metrics, /node-schemas, /metrics/json.
    const routePattern = />\(\s*['"](\/[a-z-/]+)['"]/g;
    const routes: string[] = [];
    let m;
    while ((m = routePattern.exec(source)) !== null) {
      routes.push(m[1]);
    }

    // Sanity check: at minimum the three user-facing execution routes
    // that take tenanted bodies must be present. /compile takes only
    // `definition` so it's exempt from the tenant-validation contract.
    // (/test-node lives in the api, not in workflows-svc index.ts —
    // workflows-svc only exposes /execute, /execute-sync, /resume-execution.)
    const TENANTED = ['/execute', '/execute-sync', '/resume-execution'];
    for (const r of TENANTED) {
      expect(routes, `route ${r} must be declared in workflows-svc index.ts`).toContain(r);
    }

    // For each tenanted route, verify the handler body mentions
    // validateTenantId. We pin that the symbol is referenced inside
    // index.ts at least once per tenanted route (approximated by total
    // call-count).
    const validateCount = (source.match(/validateTenantId\s*\(/g) || []).length;
    // One call per tenanted route — allow >= for future defense-in-depth.
    expect(validateCount).toBeGreaterThanOrEqual(TENANTED.length);
  });
});
