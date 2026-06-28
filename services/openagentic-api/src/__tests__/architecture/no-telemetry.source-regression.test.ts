/**
 * Architecture cage — ZERO TELEMETRY / no phone-home.
 *
 * openagentic ships with no analytics SDK, no usage beacon, no install ping,
 * no license/update check, and no error-reporting-to-a-vendor. This is a
 * load-bearing product claim (see docs/zero-telemetry.md) for the
 * sovereignty-bound ICP who is legally forbidden from shipping infra logs to a
 * SaaS. This test fails the build if anyone reintroduces telemetry.
 *
 * Three guards, all read-only file scans (no postgres / no running stack):
 *
 *   1. NO analytics / error-reporting SDK imports anywhere in api source
 *      (posthog, @sentry, segment, mixpanel, amplitude, dd-trace/@datadog,
 *      bugsnag, rollbar, fullstory, heap, hotjar, plausible, fathom, matomo,
 *      rudderstack) — neither `import ... from`, `require(...)`, nor
 *      dynamic `import('...')`.
 *
 *   2. NO phone-home verbs (sendBeacon, callHome, reportUsage,
 *      registerInstall, checkForUpdate, version-check, license-check).
 *
 *   3. NO outbound `fetch(...)` / `axios.<verb>(...)` call whose URL is a
 *      HARDCODED external host that is not on the allow-list. The allow-list
 *      is the set of LLM-provider / integration / cloud-ops APIs the product
 *      legitimately operates *with the user's own credentials* — never an
 *      analytics or Agenticwork-owned host. localhost / 127.0.0.1 /
 *      host.docker.internal / *.svc.cluster.local / template-literal
 *      (env-derived) URLs are always allowed (that's the operator's own infra).
 *
 * When you add a NEW legitimate provider/integration endpoint:
 *   - Add its host to ALLOWED_EXTERNAL_HOSTS below, in the open, via PR.
 *   - Never add an analytics/telemetry/Agenticwork-owned host.
 *
 * Companion docs: docs/zero-telemetry.md.
 * Modeled on no-hardcoded-model-literals.source-regression.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SRC = join(__dirname, '../..'); // services/openagentic-api/src

/* ------------------------------------------------------------------ */
/* Guard 1 — forbidden analytics / error-reporting SDKs                */
/* ------------------------------------------------------------------ */

/** Module specifiers that may NOT be imported/required anywhere in source.
 *  Matched against the quoted module string of an import/require/dynamic-import. */
const FORBIDDEN_SDK_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /^posthog(-node|-js)?$/, name: 'posthog' },
  { pattern: /^@sentry\//, name: '@sentry/*' },
  { pattern: /^(@segment\/|analytics-node$|@segment\/analytics-node$)/, name: 'segment' },
  { pattern: /^(mixpanel|mixpanel-browser)$/, name: 'mixpanel' },
  { pattern: /^(amplitude|@amplitude\/)/, name: 'amplitude' },
  { pattern: /^(dd-trace|@datadog\/)/, name: 'datadog/dd-trace' },
  { pattern: /^(bugsnag|@bugsnag\/)/, name: 'bugsnag' },
  { pattern: /^rollbar$/, name: 'rollbar' },
  { pattern: /^@fullstory\//, name: 'fullstory' },
  { pattern: /^(@heap\/|heap-api)$/, name: 'heap' },
  { pattern: /^(hotjar|@hotjar\/)/, name: 'hotjar' },
  { pattern: /^(plausible-tracker|@plausible\/)/, name: 'plausible' },
  { pattern: /^(fathom-client|@fathom\/)/, name: 'fathom' },
  { pattern: /^(matomo|@matomo\/)/, name: 'matomo' },
  { pattern: /^(@rudderstack\/|rudder-sdk-node)$/, name: 'rudderstack' },
];

/** Extract the module specifier from an import / require / dynamic import line. */
function moduleSpecifierOf(line: string): string | null {
  // import ... from 'x'  |  import 'x'  |  export ... from 'x'
  const fromMatch = line.match(/\bfrom\s+['"]([^'"]+)['"]/);
  if (fromMatch) return fromMatch[1];
  const bareImport = line.match(/^\s*import\s+['"]([^'"]+)['"]/);
  if (bareImport) return bareImport[1];
  // require('x')  |  import('x')
  const callMatch = line.match(/\b(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/);
  if (callMatch) return callMatch[1];
  return null;
}

/* ------------------------------------------------------------------ */
/* Guard 2 — forbidden phone-home verbs                                */
/* ------------------------------------------------------------------ */

const PHONE_HOME_PATTERNS: { pattern: RegExp; name: string }[] = [
  { pattern: /\bnavigator\s*\.\s*sendBeacon\b/, name: 'navigator.sendBeacon' },
  { pattern: /\bsendBeacon\s*\(/, name: 'sendBeacon(' },
  { pattern: /\bcallHome\b/, name: 'callHome' },
  { pattern: /\breportUsage\b/, name: 'reportUsage' },
  { pattern: /\bregisterInstall\b/, name: 'registerInstall' },
  { pattern: /\bcheckForUpdates?\b/, name: 'checkForUpdate' },
  { pattern: /\bversion[-_]?check\b/i, name: 'version-check' },
  { pattern: /\blicense[-_]?check\b/i, name: 'license-check' },
  { pattern: /\bphone[-_]?home\b/i, name: 'phone-home' },
];

/* ------------------------------------------------------------------ */
/* Guard 3 — hardcoded external hosts in outbound HTTP calls           */
/* ------------------------------------------------------------------ */

/**
 * Hosts the product legitimately calls — LLM providers, OAuth/identity,
 * integration APIs, and cloud-ops control planes — always driven by the
 * USER's own credentials. These are not telemetry. Wildcard suffixes
 * (`*.example.com`) match any subdomain.
 *
 * HARD RULE: never add an analytics host or an Agenticwork-owned host here.
 */
const ALLOWED_EXTERNAL_HOSTS: string[] = [
  // --- LLM providers (BYO key) ---
  'api.anthropic.com',
  'api.openai.com',
  '*.openai.azure.com',
  'cognitiveservices.azure.com',
  '*.cognitiveservices.azure.com',
  'generativelanguage.googleapis.com',
  'aiplatform.googleapis.com',
  '*.googleapis.com',
  // --- Identity / OAuth (SSO + provider auth) ---
  'login.microsoftonline.com',
  'graph.microsoft.com',
  'accounts.google.com',
  'oauth2.googleapis.com',
  // --- Integration APIs (user-configured) ---
  'github.com',
  'api.github.com',
  'slack.com',
  'api.botframework.com',
  // --- Cloud-ops control planes (the platform exists to operate these) ---
  'management.azure.com',
  'prices.azure.com',
];

function hostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  return ALLOWED_EXTERNAL_HOSTS.some((allowed) => {
    if (allowed.startsWith('*.')) {
      const suffix = allowed.slice(1); // ".example.com"
      return h === allowed.slice(2) || h.endsWith(suffix);
    }
    return h === allowed;
  });
}

/** Always-allowed local / private / operator-infra hosts. */
function isLocalOrPrivate(host: string): boolean {
  const h = host.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1') return true;
  if (h === 'host.docker.internal') return true;
  if (h.endsWith('.svc.cluster.local') || h.endsWith('.local')) return true;
  if (h.endsWith('.internal')) return true;
  // RFC1918 / link-local literals
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true;
  return false;
}

/**
 * Find outbound HTTP calls with a HARDCODED (non-template-literal) external
 * URL as the first argument. Template-literal URLs (`https://${host}/...`)
 * are env-derived → the operator's own endpoint → not flagged.
 */
const OUTBOUND_CALL_RE =
  /\b(?:fetch|axios\s*\.\s*(?:get|post|put|delete|patch|request)|got\s*\.\s*(?:get|post|put|delete|patch)|got)\s*\(\s*['"](https?:\/\/[^'"]+)['"]/g;

interface Violation {
  file: string;
  line: number;
  kind: string;
  excerpt: string;
}

function* walkSource(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (
        entry === '__tests__' ||
        entry === 'node_modules' ||
        entry === 'dist' ||
        entry === 'generated' ||
        entry === 'scripts'
      )
        continue;
      yield* walkSource(p);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      yield p;
    }
  }
}

function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*');
}

function scanFile(filePath: string): Violation[] {
  const rel = relative(SRC, filePath);
  const src = readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  const out: Violation[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (isCommentLine(line)) continue;

    // Guard 1 — forbidden SDK import/require
    if (/\b(?:import|require)\b/.test(line) || /\bfrom\s+['"]/.test(line)) {
      const spec = moduleSpecifierOf(line);
      if (spec) {
        for (const { pattern, name } of FORBIDDEN_SDK_PATTERNS) {
          if (pattern.test(spec)) {
            out.push({ file: rel, line: i + 1, kind: `analytics SDK import (${name})`, excerpt: line.trim() });
          }
        }
      }
    }

    // Guard 2 — phone-home verbs
    for (const { pattern, name } of PHONE_HOME_PATTERNS) {
      if (pattern.test(line)) {
        out.push({ file: rel, line: i + 1, kind: `phone-home pattern (${name})`, excerpt: line.trim() });
      }
    }

    // Guard 3 — hardcoded external host in an outbound HTTP call
    OUTBOUND_CALL_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = OUTBOUND_CALL_RE.exec(line)) !== null) {
      let host = '';
      try {
        host = new URL(m[1]).hostname;
      } catch {
        continue; // unparseable → not a concrete external host
      }
      if (isLocalOrPrivate(host)) continue;
      if (hostAllowed(host)) continue;
      out.push({
        file: rel,
        line: i + 1,
        kind: `outbound HTTP to non-allow-listed external host (${host})`,
        excerpt: line.trim(),
      });
    }
  }
  return out;
}

describe('Architecture cage — ZERO telemetry / no phone-home (api-wide)', () => {
  it('no analytics SDK import, no phone-home verb, no outbound call to a non-allow-listed external host', () => {
    const violations: Violation[] = [];
    for (const filePath of walkSource(SRC)) {
      violations.push(...scanFile(filePath));
    }

    const summary =
      violations.length === 0
        ? ''
        : `\n${violations.length} telemetry violation(s) — openagentic must send ZERO telemetry (docs/zero-telemetry.md):\n` +
          violations
            .slice(0, 40)
            .map((v) => `  ${v.file}:${v.line} — ${v.kind}\n      ${v.excerpt}`)
            .join('\n') +
          `\n\nIf this is a NEW legitimate provider/integration/cloud-ops endpoint (BYO creds),\n` +
          `add its host to ALLOWED_EXTERNAL_HOSTS in this test, in the open, via PR.\n` +
          `NEVER add an analytics host or an Agenticwork-owned host. NEVER import an analytics SDK.`;

    expect(violations, summary).toEqual([]);
  });
});
