import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  denyIfPrivate,
  isAllowedInternalHost,
  EgressBlockedError,
} from '../../utils/HostAllowList.js';

/**
 * Substrate-fix S4 (plan Tasks 1.5/1.6) — five-vector source-regression test.
 *
 * Pins the contract that `executeHTTPRequestNode` cannot be tricked by any
 * of the five known attack URL shapes:
 *
 *   1. legacy substring auto-injection: any URL whose path or query
 *      contains `openagentic-api` must NOT auto-inject the
 *      X-Internal-Secret header. Only an exact hostname match against
 *      the allow-list does.
 *
 *   2. RFC1918 (10.0.0.0/8 etc.) → must surface EgressBlockedError
 *      BEFORE any fetch fires.
 *
 *   3. IMDS link-local 169.254.169.254 → EgressBlockedError before fetch.
 *
 *   4. attacker hostname with `openagentic-api` in the PATH (e.g.
 *      `http://attacker.com/openagentic-api/path`) — substring would
 *      have matched; allow-list must not.
 *
 *   5. attacker hostname with `openagentic-api` in the QUERY STRING
 *      (e.g. `http://attacker.com/?openagentic-api=foo`) — same as #4.
 *
 * The first half of this file pins the SOURCE shape (no
 * substring-match constructs reachable from the engine). The second
 * half drives the live HostAllowList helpers through each of the five
 * URLs to verify the runtime contract holds.
 *
 * the design notes
 * the design notes
 *       Tasks 1.5 + 1.6
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ENGINE_TS = resolve(__dirname, '../../services/WorkflowExecutionEngine.ts');

const ALLOWLIST = ['openagentic-api.openagentic.svc.cluster.local'];

describe('arch: HTTPRequestNode SSRF + secret-leak hardening (5 vectors, S4)', () => {
  const content = readFileSync(ENGINE_TS, 'utf8');

  // -------------------------------------------------------------------------
  // SOURCE-LEVEL bans — vectors 1, 4, 5 share the same offender (substring).
  // -------------------------------------------------------------------------

  it('vector 1+4+5: source has no substring/regex match for "openagentic-api"', () => {
    const banned: Array<[RegExp, string]> = [
      [/url(?:\.toString\(\))?\.includes\(['"]openagentic-api['"]\)/, '.includes("openagentic-api")'],
      [/resolvedUrl\.includes\(['"]openagentic-api['"]\)/, 'resolvedUrl.includes("openagentic-api")'],
      [/url(?:\.toString\(\))?\.indexOf\(['"]openagentic-api['"]\)\s*[!>=]/, '.indexOf("openagentic-api")'],
      [/resolvedUrl\.includes\(['"]localhost:8000['"]\)/, 'resolvedUrl.includes("localhost:8000")'],
      [/\.match\(\s*\/openagentic-api\//, '.match(/openagentic-api/...)'],
    ];
    const violations = banned.filter(([re]) => re.test(content)).map(([, label]) => label);
    expect(violations).toEqual([]);
  });

  // NOTE: the HTTP node executor (and its denyIfPrivate → allow-list ordering)
  // now lives in the shared workflow-engine package
  // (services/shared/workflow-engine/src/nodes/http_request/), which carries its
  // own executor-level regression tests. The engine-source contract pinned here
  // is limited to the substring-ban above; the runtime contract below still
  // exercises the HostAllowList helpers directly.

  // -------------------------------------------------------------------------
  // RUNTIME contract — drive the helpers through each of the 5 URL shapes.
  // -------------------------------------------------------------------------

  it('vector 1: substring URL `http://attacker.com/openagentic-api/` is NOT internal', async () => {
    const ok = await isAllowedInternalHost(
      new URL('http://attacker.com/openagentic-api/path'),
      ALLOWLIST,
    );
    expect(ok).toBe(false);
  });

  it('vector 2: RFC1918 `http://10.0.0.5/` → EgressBlockedError("rfc1918")', async () => {
    await expect(denyIfPrivate('http://10.0.0.5/whatever')).rejects.toThrow(EgressBlockedError);
    await expect(denyIfPrivate('http://10.0.0.5/whatever')).rejects.toThrow(/rfc1918/);
  });

  it('vector 3: IMDS `http://169.254.169.254/` → EgressBlockedError("imds")', async () => {
    await expect(denyIfPrivate('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(
      EgressBlockedError,
    );
    await expect(denyIfPrivate('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/imds/);
  });

  it('vector 4: attacker host with substring-in-path is NOT internal', async () => {
    const ok = await isAllowedInternalHost(
      new URL('http://attacker.com/openagentic-api/path'),
      ALLOWLIST,
    );
    expect(ok).toBe(false);
  });

  it('vector 5: attacker host with substring-in-query is NOT internal', async () => {
    const ok = await isAllowedInternalHost(
      new URL('http://attacker.com/?openagentic-api=foo'),
      ALLOWLIST,
    );
    expect(ok).toBe(false);
  });

  it('positive control: exact-match cluster FQDN IS internal', async () => {
    const ok = await isAllowedInternalHost(
      new URL('http://openagentic-api.openagentic.svc.cluster.local:3001/admin/ping'),
      ALLOWLIST,
    );
    expect(ok).toBe(true);
  });
});
