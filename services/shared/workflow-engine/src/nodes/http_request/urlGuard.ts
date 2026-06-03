/**
 * urlGuard.ts — SSRF + internal-secret-leak hardening for the shared
 * http_request node executor.
 *
 * Mirrors the hardening that the main WorkflowExecutionEngine host-allowlist
 * applied (substrate-fix S4 Sev-0). The shared-package executor
 * (`nodes/http_request/executor.ts`) was migrated from the legacy engine method
 * but never received the same fix — it still used a substring match
 * (`resolvedUrl.includes('openagentic-api')`) to decide whether to auto-inject
 * the `X-Internal-Secret` header, and issued the request with no SSRF
 * validation at all.
 *
 * Three concerns, three exports:
 *
 *   1. `classifyInternalHost(url)` — STRICT host-component check. Parses the URL
 *      with `new URL(...)` and matches the *hostname* (never the whole URL
 *      string) against an exact internal-service allowlist. A URL like
 *      `https://attacker.com/openagentic-api/x` has hostname `attacker.com` →
 *      NOT internal, so the secret is never leaked to attacker infra.
 *
 *   2. `assertEgressAllowed(url)` — SSRF gate. Rejects non-http(s) schemes and
 *      any target that resolves to a private / loopback / link-local IP range
 *      or the cloud-metadata IP (169.254.169.254). Internal-allowlisted hosts
 *      are exempt (they legitimately resolve to cluster-private IPs); everything
 *      else is denied if it points at private space. Literal-IP + IMDS-hostname
 *      vectors are blocked WITHOUT any DNS lookup; DNS hostnames are resolved
 *      and every A/AAAA record range-checked (catching DNS-rebinding to private
 *      space). A resolution failure is not itself a block — the request fails at
 *      the transport layer anyway — so a missing resolver never blanket-blocks
 *      legitimate external hosts.
 *
 *   3. `filterResponseHeaders(headers)` — strips sensitive response headers
 *      (set-cookie, authorization, www-authenticate, x-internal-*,
 *      proxy-authorization, etc.) before the response is returned into the
 *      flow output, so a flow author can't exfiltrate auth material echoed by
 *      an upstream service.
 */

import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

/** Raised by the SSRF gate. The executor wraps it into a node error. */
export class EgressBlockedError extends Error {
  public readonly reason: string;
  public readonly target: string;
  constructor(reason: string, target: string) {
    super(`HTTP request blocked: ${reason}: ${target}`);
    this.name = 'EgressBlockedError';
    this.reason = reason;
    this.target = target;
  }
}

/**
 * Exact internal-service host allowlist. These are the ONLY hostnames that
 * may receive the auto-injected internal-auth secret, and the only ones
 * exempt from the private-IP SSRF block (they legitimately resolve to
 * cluster-private addresses).
 *
 * Matched against the parsed URL's hostname component (no port, no path,
 * no query). Short-names (Kubernetes Service DNS), their cluster FQDN
 * forms, and the loopback aliases for local dev are covered. Override /
 * extend via `INTERNAL_HOST_ALLOWLIST` (comma-separated) at the wiring
 * site if needed.
 */
const INTERNAL_HOST_ALLOWLIST: readonly string[] = [
  'openagentic-api',
  'openagentic-mcp-proxy',
  'openagentic-proxy',
  'localhost',
];

/** Cloud-metadata hostnames/IPs blocked verbatim (no DNS lookup needed). */
const IMDS_HOSTS = new Set<string>([
  '169.254.169.254',
  'fd00:ec2::254',
  'metadata.google.internal',
  'metadata.azure.com',
]);

function toUrl(input: URL | string): URL {
  return input instanceof URL ? input : new URL(input);
}

/**
 * True when `host` exactly equals an allowlist entry, OR is a cluster-FQDN
 * extension of a short-name entry (e.g. allowlist `openagentic-api` matches
 * `openagentic-api.openagentic.svc.cluster.local`). NEVER a substring of the
 * whole URL — the match is scoped to the hostname component only.
 */
function hostMatchesInternal(host: string, allowlist: readonly string[]): boolean {
  const h = host.toLowerCase();
  for (const raw of allowlist) {
    const entry = raw.toLowerCase();
    if (h === entry) return true;
    // short-name → cluster FQDN: `openagentic-api` matches
    // `openagentic-api.<ns>.svc.cluster.local` but NOT `openagentic-api.evil.com`.
    if (h.startsWith(`${entry}.`) && h.endsWith('.svc.cluster.local')) {
      return true;
    }
  }
  return false;
}

/**
 * Classify a resolved URL as a genuine internal service.
 *
 * STRICT: parses the URL and matches the HOSTNAME component against the exact
 * internal allowlist. Returns false (and never throws) for unparseable URLs —
 * the executor handles invalid URLs separately.
 */
export function classifyInternalHost(
  url: URL | string,
  allowlist: readonly string[] = INTERNAL_HOST_ALLOWLIST,
): boolean {
  let u: URL;
  try {
    u = toUrl(url);
  } catch {
    return false;
  }
  return hostMatchesInternal(u.hostname, allowlist);
}

/** IPv4 RFC1918 private ranges: 10/8, 172.16/12, 192.168/16. */
function isRfc1918(ip: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isLoopbackIp(ip: string): boolean {
  return /^127\./.test(ip) || ip === '::1' || ip === '0.0.0.0';
}

function isLinkLocalIp(ip: string): boolean {
  // IPv4 169.254.0.0/16 (IMDS lives here) + IPv6 fe80::/10.
  if (/^169\.254\./.test(ip)) return true;
  const lower = ip.toLowerCase();
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true;
  }
  return false;
}

/** IPv6 unique-local fc00::/7 (fc.. / fd..). */
function isUniqueLocalIp6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return lower.startsWith('fc') || lower.startsWith('fd');
}

/** Throw EgressBlockedError if a single resolved IP is in any blocked range. */
function checkIp(ip: string, target: string): void {
  if (ip === '169.254.169.254' || ip === 'fd00:ec2::254') {
    throw new EgressBlockedError('imds', target);
  }
  if (isLoopbackIp(ip)) {
    throw new EgressBlockedError('loopback', target);
  }
  if (isLinkLocalIp(ip)) {
    throw new EgressBlockedError('link_local', target);
  }
  if (isRfc1918(ip)) {
    throw new EgressBlockedError('rfc1918', target);
  }
  if (isIP(ip) === 6 && isUniqueLocalIp6(ip)) {
    throw new EgressBlockedError('unique_local', target);
  }
}

/**
 * SSRF gate. Call BEFORE issuing the request.
 *
 *  - Rejects non-http(s) schemes (file:, gopher:, dict:, ftp:, etc.).
 *  - Internal-allowlisted hosts are permitted as-is (they resolve to
 *    cluster-private IPs by design and are the only trusted private targets).
 *  - Literal IMDS hostname/IP → blocked verbatim.
 *  - Literal IP hostnames → range-checked directly.
 *  - DNS hostnames → resolved; EVERY A/AAAA record range-checked. Fail-closed
 *    on resolution error (a non-resolving host is not a safe egress target).
 *
 * The `isInternal` flag lets the caller skip DNS/range checks for hosts it has
 * already classified as internal (avoids a redundant resolve + lets short-name
 * cluster DNS, which doesn't resolve outside the cluster, still work).
 */
export async function assertEgressAllowed(
  url: URL | string,
  opts: { isInternal?: boolean } = {},
): Promise<void> {
  const u = toUrl(url);

  // 1. Scheme allowlist — only http/https may ever egress.
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new EgressBlockedError('scheme', u.protocol.replace(/:$/, ''));
  }

  const host = u.hostname;

  // 2. Internal-allowlisted hosts are the trusted private targets. Skip the
  //    private-IP block for them (cluster DNS / loopback dev are intentional).
  if (opts.isInternal) {
    return;
  }

  // 3. Literal IMDS / cloud-metadata hostnames → blocked verbatim.
  if (IMDS_HOSTS.has(host.toLowerCase())) {
    throw new EgressBlockedError('imds', host);
  }

  // 4. Hostname IS a literal IP → range-check directly (no DNS).
  const ipFamily = isIP(host);
  if (ipFamily !== 0) {
    checkIp(host, host);
    return;
  }

  // 5. DNS hostname → resolve A + AAAA, range-check every record so a public
  //    name that points at private space (DNS-rebinding / split-horizon) is
  //    caught. Resolution failure is NOT treated as a block here: the request
  //    would fail at the transport layer anyway, and the high-value literal-IP
  //    + IMDS vectors are already caught above. This keeps the guard from
  //    blocking every legitimate external host when no resolver is reachable.
  let ips: string[] = [];
  try {
    const a = await dns.resolve4(host).catch(() => [] as string[]);
    const aaaa = await dns.resolve6(host).catch(() => [] as string[]);
    ips = [...a, ...aaaa];
  } catch {
    ips = [];
  }
  for (const ip of ips) {
    checkIp(ip, host);
  }
}

/**
 * Response headers that must NEVER be surfaced into the flow output — they
 * carry auth material an upstream service may echo and a flow author could
 * otherwise exfiltrate.
 */
const SENSITIVE_RESPONSE_HEADERS = new Set<string>([
  'set-cookie',
  'set-cookie2',
  'authorization',
  'proxy-authorization',
  'www-authenticate',
  'proxy-authenticate',
  'cookie',
]);

/** Prefixes whose headers are always stripped (internal-secret echoes, etc.). */
const SENSITIVE_RESPONSE_HEADER_PREFIXES = ['x-internal', 'x-amz-security', 'x-aws-'];

/**
 * Strip sensitive headers from an axios response-headers object before it is
 * returned into the flow output. Preserves everything else (content-type,
 * content-length, etc.) so legitimate downstream nodes keep working.
 *
 * Header keys are matched case-insensitively (axios lower-cases response header
 * keys, but we don't rely on that).
 */
export function filterResponseHeaders(
  headers: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!headers || typeof headers !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (SENSITIVE_RESPONSE_HEADERS.has(lower)) continue;
    if (SENSITIVE_RESPONSE_HEADER_PREFIXES.some((p) => lower.startsWith(p))) continue;
    out[key] = value;
  }
  return out;
}
