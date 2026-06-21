/**
 * CdnAllowList — server-side script-src URL validator (#474 / #491).
 *
 * compose_app payloads from the model arrive as HTML/JS strings. Before
 * we mount them in the sandboxed iframe (srcdoc), we validate that every
 * `<script src="...">` URL resolves to the same-origin /api/cdn/lib/*
 * path that the UI serves.
 *
 * Allow-list (production):
 *   - /api/cdn/lib/...                           — preferred (relative path)
 *   - https://${any-host}/api/cdn/lib/...        — absolute (any host, path
 *                                                   prefix and traversal-safe)
 *
 * Allow-list (when `allowExternalCdn: true`, dev/test only):
 *   - https://cdn.jsdelivr.net/...
 *   - https://unpkg.com/...
 *   - https://cdnjs.cloudflare.com/...
 *
 * ALWAYS rejected:
 *   - any external CDN hostname (no DNS/ingress; serve same-origin instead)
 *   - skypack.dev (sunsetting per https://www.jsdelivr.com/skypack)
 *   - esm.sh (weak audit history)
 *   - any other host, raw IPs, http://, data:, blob:
 *
 * Inline scripts (no `src`) are NOT validated here — a separate no-eval
 * rule covers those. The function returns ALL violations so the model /
 * UI can correct the entire payload at once.
 */

export interface CdnAllowListOptions {
  /**
   * When true (dev/test only), permits jsdelivr / unpkg / cdnjs in
   * addition to the cluster-internal CDN. Default: false (internal only).
   * Wire this from `featureFlags.allowExternalCdn` so production builds
   * default-deny.
   */
  allowExternalCdn?: boolean;
}

export interface CdnAllowListResult {
  ok: boolean;
  /** Every violating URL, in document order. Empty when ok=true. */
  violations: string[];
}

/**
 * Same-origin CDN path — the UI serves vendored libraries under
 * `/api/cdn/lib/*` from the parent origin. There is no external DNS,
 * ingress, or TLS cert involved. Browsers always fetch from the parent
 * origin, so the absolute URL form embeds whatever host the user is on:
 *   - `/api/cdn/lib/...`                    (relative — preferred)
 *   - `https://anything/api/cdn/lib/...`    (absolute, any host — accepted
 *                                             because the UI nginx is the
 *                                             only thing that can resolve
 *                                             the internal svc anyway)
 *
 * Path-traversal attempts (`/api/cdn/lib/../etc/passwd`) are rejected
 * by checking the normalized path stays under `/api/cdn/lib/`.
 */
const SAME_ORIGIN_CDN_PATH = '/api/cdn/lib/';

function isSameOriginCdnPath(path: string): boolean {
  if (!path.startsWith(SAME_ORIGIN_CDN_PATH)) return false;
  // #484 C3 — reject traversal across raw, single-decoded, AND double-decoded
  // forms. nginx upstream URL-decodes before path resolution, so payloads like
  // `..%2f` (single-encoded /) and `..%252f` (double-encoded /) decode to `../`
  // at the upstream and reach files outside the allowed root.
  let remainder = path.slice(SAME_ORIGIN_CDN_PATH.length);
  // Reject any backslash anywhere — some servers normalize \ to /.
  if (remainder.includes('\\')) return false;
  // Iteratively decode (max 3 passes) to defeat n-times encoding.
  for (let i = 0; i < 3; i++) {
    let next: string;
    try {
      next = decodeURIComponent(remainder);
    } catch {
      // Malformed encoding — refuse.
      return false;
    }
    if (next === remainder) break;
    remainder = next;
  }
  // Reject any '..' or '.' segment in the fully-decoded form.
  if (remainder.split(/[/\\]/).some((seg) => seg === '..' || seg === '.')) return false;
  // Defense in depth — reject any remaining '%' which signals further encoding.
  if (remainder.includes('%')) return false;
  return true;
}

/** Externally-hosted CDNs — allowed only when allowExternalCdn=true. */
const DEV_EXTERNAL_CDN_HOSTS = new Set([
  'cdn.jsdelivr.net',
  'unpkg.com',
  'cdnjs.cloudflare.com',
]);

/**
 * Hosts we NEVER allow even in dev mode. Listed explicitly so that future
 * expansion of `DEV_EXTERNAL_CDN_HOSTS` can't accidentally permit them.
 */
const ALWAYS_REJECT_HOSTS = new Set([
  'cdn.skypack.dev',
  'esm.sh',
]);

/**
 * Match `<script ... src="..."` (or single-quoted, case-insensitive).
 * Captures group 1 = the src URL. Tolerates other attrs in any order.
 */
const SCRIPT_SRC_REGEX = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi;

function isUrlAllowed(url: string, allowExternalCdn: boolean): boolean {
  // Same-origin CDN proxy — relative path, preferred form.
  if (url.startsWith('/')) {
    return isSameOriginCdnPath(url);
  }

  // Anything else needs to be https:// + a host we know.
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;

  if (ALWAYS_REJECT_HOSTS.has(parsed.host)) return false;

  // Same-origin CDN proxy — absolute form on ANY host (model may inline
  // chat.example.com or chat.openagentic.io). Path must still
  // start with /api/cdn/lib/ and pass the traversal check.
  if (isSameOriginCdnPath(parsed.pathname)) return true;

  if (allowExternalCdn && DEV_EXTERNAL_CDN_HOSTS.has(parsed.host)) {
    return true;
  }

  return false;
}

export function validateScriptUrls(
  html: string,
  opts: CdnAllowListOptions = {},
): CdnAllowListResult {
  const allowExternalCdn = opts.allowExternalCdn === true;
  const violations: string[] = [];

  if (!html) return { ok: true, violations };

  // Reset regex lastIndex (g flag is stateful per regex instance).
  SCRIPT_SRC_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SCRIPT_SRC_REGEX.exec(html)) !== null) {
    const src = match[1];
    if (!isUrlAllowed(src, allowExternalCdn)) {
      violations.push(src);
    }
  }

  return { ok: violations.length === 0, violations };
}
