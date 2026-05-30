import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Substrate-fix S4 (spec §3) source-regression arch test.
 *
 * The legacy code in WorkflowExecutionEngine.executeHTTPRequestNode
 * substring-matched the resolved URL for `openagentic-api` (and
 * `localhost:8000`) and auto-injected the X-Internal-Secret header.
 *
 * That is an SSRF + cross-tenant auth-leak hazard:
 *   - workflow author can target `http://openagentic-api.evil.com/`
 *     and the engine will trust the secret to a hostile destination.
 *   - workflow author can target `http://169.254.169.254/...` (IMDS)
 *     to exfil cloud creds.
 *
 * This arch test pins the contract:
 *   1. NO substring/regex match for `openagentic-api` gates the secret.
 *   2. The engine imports HostAllowList helpers (denyIfPrivate +
 *      isAllowedInternalHost) and uses them.
 *
 * Spec: docs/superpowers/specs/2026-05-09-v3-enterprise-chatmode-design.md §3 S4
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENGINE_TS = resolve(__dirname, '../../services/WorkflowExecutionEngine.ts');

describe('arch: WorkflowExecutionEngine.executeHTTPRequestNode hardening (S4)', () => {
  const content = readFileSync(ENGINE_TS, 'utf8');

  it('does NOT substring-match for "openagentic-api" to inject X-Internal-Secret', () => {
    // Bans every form of substring-detection that gates the secret header.
    const banned: Array<[RegExp, string]> = [
      [/url(?:\.toString\(\))?\.includes\(['"]openagentic-api['"]\)/, '.includes("openagentic-api")'],
      [/resolvedUrl\.includes\(['"]openagentic-api['"]\)/, 'resolvedUrl.includes("openagentic-api")'],
      [/url(?:\.toString\(\))?\.indexOf\(['"]openagentic-api['"]\)\s*[!>=]/, '.indexOf("openagentic-api")'],
      [/\/openagentic-api\//, 'regex literal /openagentic-api/'],
      [/resolvedUrl\.includes\(['"]localhost:8000['"]\)/, 'resolvedUrl.includes("localhost:8000")'],
    ];
    const violations = banned.filter(([re]) => re.test(content)).map(([, label]) => label);
    expect(violations).toEqual([]);
  });

  it('imports HostAllowList helpers (denyIfPrivate + isAllowedInternalHost)', () => {
    expect(content).toMatch(/import\s*\{[^}]*denyIfPrivate[^}]*\}\s*from\s*['"][^'"]*HostAllowList(?:\.js)?['"]/);
    expect(content).toMatch(/\bdenyIfPrivate\s*\(/);
    expect(content).toMatch(/\bisAllowedInternalHost\s*\(/);
  });
});
