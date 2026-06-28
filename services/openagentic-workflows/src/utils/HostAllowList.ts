/**
 * HostAllowList — substrate-fix S4 (spec §3).
 *
 * Replaces the substring-match `X-Internal-Secret` injection in
 * WorkflowExecutionEngine.executeHTTPRequestNode with an explicit
 * deny-then-allowlist gate.
 *
 * Three exports:
 *   - `denyIfPrivate(url)` — throws EgressBlockedError if the target
 *     resolves to RFC1918, loopback, link-local (IMDS), `.svc.cluster.local`,
 *     or a known cloud-metadata hostname. Always called BEFORE any
 *     header injection.
 *
 *   - `isAllowedInternalHost(url, allowlist)` — exact-match host check
 *     (no wildcards). Used to gate X-Internal-Secret on workflow HTTP
 *     calls that target the internal cluster API. Empty allowlist → false.
 *
 *   - `isAllowedExternalHost(url, allowlist)` — exact-match OR wildcard
 *     suffix (`*.example.com` matches `foo.example.com` AND
 *     `example.com`). Used by future external-egress allowlist gates.
 */

import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

export class EgressBlockedError extends Error {
  public readonly reason: string;
  public readonly target: string;
  constructor(reason: string, target: string) {
    super(`egress blocked: ${reason}: ${target}`);
    this.name = 'EgressBlockedError';
    this.reason = reason;
    this.target = target;
  }
}

/** Cloud-metadata hostnames blocked verbatim (no DNS lookup). */
const IMDS_HOSTS = new Set<string>([
  '169.254.169.254',
  'fd00:ec2::254',
  'metadata.google.internal',
  'metadata.azure.com',
]);

/**
 * Coerce input to a URL instance. Throws if invalid (caller-side bug).
 */
function toUrl(input: URL | string): URL {
  return input instanceof URL ? input : new URL(input);
}

/**
 * Returns true if the IPv4 string is in any RFC1918 range.
 *   10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
 */
function isRfc1918(ip: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isLoopback(ip: string): boolean {
  return /^127\./.test(ip) || ip === '::1';
}

function isLinkLocal(ip: string): boolean {
  // 169.254.0.0/16 — IMDS lives here.
  return /^169\.254\./.test(ip);
}

/**
 * Inspect a single resolved IP and throw EgressBlockedError if it falls
 * into any blocked range.
 */
function checkIp(ip: string, target: string): void {
  if (isLoopback(ip)) {
    throw new EgressBlockedError('loopback', ip);
  }
  if (isLinkLocal(ip)) {
    throw new EgressBlockedError('imds', ip);
  }
  if (isRfc1918(ip)) {
    throw new EgressBlockedError('rfc1918', ip);
  }
}

/**
 * Reject the URL if its host is private, link-local, loopback,
 * a cluster-local cluster service, or a known cloud-metadata hostname.
 *
 * Resolves DNS for non-IP hostnames; treats DNS failures as denied
 * (fail-closed) — workflows should not silently fall through if name
 * resolution is broken.
 */
export async function denyIfPrivate(url: URL | string): Promise<void> {
  const u = toUrl(url);
  const host = u.hostname;

  // 1. Cluster-local services — never permitted as workflow HTTP targets
  //    other than via the explicit allowlist (and even then only after
  //    `denyIfPrivate` is called BEFORE the allowlist check, this branch
  //    is a hard floor).
  //
  //    NOTE: the actual S4 wiring calls denyIfPrivate FIRST, so the
  //    internal cluster URL is denied here. The allowlist is only
  //    consulted for external-resolvable hosts.
  if (host.endsWith('.svc.cluster.local')) {
    throw new EgressBlockedError('cluster_local', host);
  }

  // 2. Literal IMDS / cloud-metadata hostnames.
  if (IMDS_HOSTS.has(host)) {
    throw new EgressBlockedError('imds', host);
  }

  // 3. Hostname-as-IP (skip DNS).
  const ipFamily = isIP(host);
  if (ipFamily !== 0) {
    checkIp(host, host);
    return;
  }

  // 4. Resolve via DNS, check every A record. Fail-closed on resolution
  //    error.
  let ips: string[];
  try {
    ips = await dns.resolve4(host);
  } catch {
    throw new EgressBlockedError('dns_failure', host);
  }
  if (!ips.length) {
    throw new EgressBlockedError('dns_failure', host);
  }
  for (const ip of ips) {
    checkIp(ip, host);
  }
}

/**
 * Exact-match the URL host against the allowlist. No wildcards.
 *
 * Designed for the X-Internal-Secret gate in
 * WorkflowExecutionEngine.executeHTTPRequestNode: only an explicit list
 * of fully-qualified internal hosts (e.g.
 * `openagentic-api.openagentic.svc.cluster.local`) trusts the secret.
 *
 * Empty allowlist → always false.
 */
export async function isAllowedInternalHost(
  url: URL | string,
  allowlist: readonly string[],
): Promise<boolean> {
  if (!allowlist || allowlist.length === 0) return false;
  const u = toUrl(url);
  const host = u.hostname;
  return allowlist.some((entry) => entry === host);
}

/**
 * Exact-match OR wildcard-suffix match. `*.example.com` matches both
 * `foo.example.com` and the apex `example.com`.
 */
export async function isAllowedExternalHost(
  url: URL | string,
  allowlist: readonly string[],
): Promise<boolean> {
  if (!allowlist || allowlist.length === 0) return false;
  const u = toUrl(url);
  const host = u.hostname;
  for (const entry of allowlist) {
    if (entry === host) return true;
    if (entry.startsWith('*.')) {
      const suffix = entry.slice(2); // drop "*."
      if (host === suffix) return true;
      if (host.endsWith(`.${suffix}`)) return true;
    }
  }
  return false;
}
