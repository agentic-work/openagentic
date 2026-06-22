/**
 * composeAppValidator — server-side gate for compose_app HTML (#474).
 *
 * Pipeline (in order, ALL violations reported together):
 *   1. Size cap          — DoS / cost control
 *   2. CdnAllowList      — script src URLs (composed from CdnAllowList.ts)
 *   3. No-eval rule      — refuses `eval(...)` / `new Function(...)`
 *   4. No-nested-iframe  — refuses any <iframe>; sandbox-escape risk
 *
 * The validator is purely synchronous + dependency-free at runtime
 * (only imports CdnAllowList). The full ComposeAppTool wires this into
 * an Anthropic tool-schema handler that emits `app_render` NDJSON; that
 * tool will land as Phase 4 step 3.
 */

import { randomBytes } from 'crypto';
import { validateScriptUrls } from './CdnAllowList.js';

export interface ComposeAppValidatorOptions {
  /** Hard cap on payload bytes. Default 1 MiB. */
  maxBytes?: number;
  /** Pass-through to CdnAllowList — dev/test only. */
  allowExternalCdn?: boolean;
}

export interface ComposeAppValidationResult {
  ok: boolean;
  /** All errors in deterministic order. Empty when ok=true. */
  errors: string[];
  /**
   * #487 — fresh per-render base64-url nonce (16 random bytes → 22 chars
   * after URL-safe encoding). Present only when ok=true. AppRenderer
   * injects this into the iframe's CSP `script-src 'nonce-XXX'` so we
   * can drop `'unsafe-inline'` while still allowing the validated
   * inline glue scripts to run.
   */
  nonce?: string;
  /**
   * #487 — html with `nonce="<value>"` attached to every `<script>` tag
   * (both inline and external src). Present only when ok=true. Mismatch
   * between the response CSP nonce and any unmarked script causes the
   * browser to refuse execution.
   */
  hardenedHtml?: string;
}

const DEFAULT_MAX_BYTES = 1024 * 1024; // 1 MiB

/**
 * Match `eval(` or `new Function(` as JavaScript calls.
 *
 * Word-boundary on the leading side prevents matches inside identifiers
 * like `evaluator` or `_eval_helper`. The required `(` after the name
 * (with optional whitespace) means we ONLY flag actual call expressions.
 *
 * Comments slip through naturally: `// don't use eval here` doesn't have
 * a trailing `(`, so the regex doesn't match it. Acceptable false-negative.
 */
const EVAL_CALL_REGEX = /\beval\s*\(/g;
const NEW_FUNCTION_REGEX = /\bnew\s+Function\s*\(/g;

/** Match any `<iframe ...>` (incl. self-closing). Case-insensitive. */
const IFRAME_OPEN_REGEX = /<iframe\b/gi;

function checkSize(html: string, maxBytes: number, errors: string[]): void {
  // Byte length, not char length — emoji + non-ASCII users would slip
  // past a .length check.
  const bytes = Buffer.byteLength(html, 'utf8');
  if (bytes > maxBytes) {
    errors.push(
      `compose_app payload size ${bytes} bytes exceeds cap of ${maxBytes} bytes`,
    );
  }
}

function checkCdnAllowList(
  html: string,
  allowExternalCdn: boolean,
  errors: string[],
): void {
  const r = validateScriptUrls(html, { allowExternalCdn });
  if (!r.ok) {
    for (const url of r.violations) {
      errors.push(
        `script src URL not on /api/cdn/lib/ allow-list: ${url}`,
      );
    }
  }
}

function checkNoEval(html: string, errors: string[]): void {
  EVAL_CALL_REGEX.lastIndex = 0;
  if (EVAL_CALL_REGEX.test(html)) {
    errors.push('compose_app payload contains eval(...) call — not allowed');
  }
  NEW_FUNCTION_REGEX.lastIndex = 0;
  if (NEW_FUNCTION_REGEX.test(html)) {
    errors.push(
      'compose_app payload contains new Function(...) call — not allowed',
    );
  }
}

function checkNoNestedIframe(html: string, errors: string[]): void {
  IFRAME_OPEN_REGEX.lastIndex = 0;
  if (IFRAME_OPEN_REGEX.test(html)) {
    errors.push(
      'compose_app payload contains nested <iframe> — sandbox-escape risk, not allowed',
    );
  }
}

/**
 * #487 — generate a fresh URL-safe base64 nonce per render. 16 random
 * bytes → 22 chars after stripping base64 padding (matches CSP3 spec
 * `nonce-source = "'nonce-" base64-value "'"` requirement).
 */
function generateNonce(): string {
  return randomBytes(16).toString('base64url');
}

/**
 * #487 — attach `nonce="<value>"` to every `<script` opening tag in the
 * payload. Both inline (`<script>...`) and external (`<script src=...>`)
 * tags get the attribute. Existing attributes are preserved.
 *
 * The regex matches `<script` followed by an attribute-list-or-`>`
 * boundary so we don't accidentally rewrite text content like
 * `"the <script tag is..."`. We then inject ` nonce="…"` immediately
 * after `script` and before any existing attributes.
 */
function attachNonceToScripts(html: string, nonce: string): string {
  return html.replace(/<script(\s|>)/gi, (_match, boundary) => {
    return `<script nonce="${nonce}"${boundary}`;
  });
}

export function validateComposeAppPayload(
  html: string,
  opts: ComposeAppValidatorOptions = {},
): ComposeAppValidationResult {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const allowExternalCdn = opts.allowExternalCdn === true;
  const errors: string[] = [];

  if (!html) {
    return { ok: true, errors };
  }

  checkSize(html, maxBytes, errors);
  checkCdnAllowList(html, allowExternalCdn, errors);
  checkNoEval(html, errors);
  checkNoNestedIframe(html, errors);

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  // #487 — Only harden + emit nonce on successful validation. Failed
  // payloads return errors only; nonce/hardenedHtml stay undefined.
  const nonce = generateNonce();
  const hardenedHtml = attachNonceToScripts(html, nonce);
  return { ok: true, errors, nonce, hardenedHtml };
}
