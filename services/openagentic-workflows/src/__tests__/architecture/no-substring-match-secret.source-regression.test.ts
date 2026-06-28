import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Substrate-fix S4 (spec §3) source-regression arch test.
 *
 * Historically the engine's HTTP node substring-matched the resolved URL
 * for `openagentic-api` (and `localhost:8000`) and auto-injected the
 * X-Internal-Secret header — an SSRF + cross-tenant auth-leak hazard.
 *
 * The HTTP node executor now lives in the shared workflow-engine package
 * (services/shared/workflow-engine/src/nodes/http_request/), which owns the
 * denyIfPrivate / allow-list SSRF guard and its own regression tests. This
 * arch test pins the remaining engine-source contract:
 *   - NO substring/regex match for `openagentic-api` gates the secret in
 *     WorkflowExecutionEngine.ts.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENGINE_TS = resolve(__dirname, '../../services/WorkflowExecutionEngine.ts');

describe('arch: WorkflowExecutionEngine HTTP secret-injection hardening (S4)', () => {
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
});
