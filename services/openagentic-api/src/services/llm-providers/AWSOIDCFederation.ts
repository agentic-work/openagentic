/**
 * AWS OIDC Federation — AssumeRoleWithWebIdentity
 *
 * Exchanges a user's Azure AD ID token for short-lived AWS credentials
 * via STS::AssumeRoleWithWebIdentity. Mirrors the Python reference at
 * `services/mcps/oap-aws-mcp/server.py::_get_credentials_via_direct_oidc`.
 *
 * Static access keys are explicitly forbidden — every AWS call made on
 * behalf of a user must resolve creds through this module.
 *
 * Environment contract (set in the chart):
 *   - AWS_OBO_ROLE_ARN (preferred) — full IAM role ARN to assume
 *   - AWS_ACCOUNT_ID   (fallback)  — used to construct
 *                                    `arn:aws:iam::<account>:role/OpenAgenticOBORole`
 *   - AWS_REGION                   — defaults to `us-east-1`
 */

import crypto from 'crypto';
import {
  STSClient,
  AssumeRoleWithWebIdentityCommand,
} from '@aws-sdk/client-sts';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AWSOIDCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration: Date;
}

export interface AssumeRoleOptions {
  /** Full IAM role ARN. Falls back to env AWS_OBO_ROLE_ARN, then constructed from AWS_ACCOUNT_ID. */
  roleArn?: string;
  /** User identifier used to derive RoleSessionName (email or upn). */
  userEmail?: string;
  /** Session duration seconds (default 3600). */
  durationSeconds?: number;
  /** AWS region for the STS client (default env AWS_REGION or us-east-1). */
  region?: string;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface CacheEntry {
  creds: AWSOIDCredentials;
  expiresAt: number; // epoch ms
}

/** In-memory LRU-ish cache keyed by SHA-256(aadToken). Bounded at 256 entries. */
const CACHE_MAX_ENTRIES = 256;
const credentialCache = new Map<string, CacheEntry>();

/** Clients are keyed by region — light-weight singletons (no per-user state). */
const stsClientByRegion = new Map<string, STSClient>();

function getSTSClient(region: string): STSClient {
  const cached = stsClientByRegion.get(region);
  if (cached) return cached;
  const client = new STSClient({ region });
  stsClientByRegion.set(region, client);
  return client;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function resolveRoleArn(opts: AssumeRoleOptions): string {
  if (opts.roleArn) return opts.roleArn;

  const envArn = process.env.AWS_OBO_ROLE_ARN;
  if (envArn && envArn.trim()) return envArn;

  const accountId = process.env.AWS_ACCOUNT_ID;
  if (accountId && accountId.trim()) {
    return `arn:aws:iam::${accountId}:role/OpenAgenticOBORole`;
  }

  throw new Error(
    'AWS OIDC federation: unable to resolve RoleArn — set opts.roleArn, ' +
      'env AWS_OBO_ROLE_ARN, or env AWS_ACCOUNT_ID.',
  );
}

/**
 * Derive a deterministic RoleSessionName from the user identifier.
 * Matches the Python reference:
 *   user.replace('@', '-at-').replace('.', '-')[:32]
 *
 * STS allows [\w+=,.@-] up to 64 chars. We cap at 32 to leave room for
 * any future `obo-` style prefix callers want to add, and to match the
 * Python cap so both code paths produce identical names for the same user.
 */
export function deriveRoleSessionName(userEmail?: string): string {
  const raw = (userEmail && userEmail.trim()) || 'anonymous';
  // @ → -at-, then every . → - (matches Python's .replace chain).
  const sanitized = raw.replace(/@/g, '-at-').replace(/\./g, '-');
  // Strip any remaining characters outside STS's allowed set.
  const safe = sanitized.replace(/[^\w+=,@-]/g, '-');
  return safe.slice(0, 32);
}

function computeCacheTTLSeconds(
  expiration: Date,
  requestedDurationSeconds: number,
): number {
  const now = Date.now();
  const credLifeSeconds = Math.floor((expiration.getTime() - now) / 1000);
  // Cache slightly shorter than the credential itself — give the caller a
  // small safety buffer so a cache hit never returns near-expired creds.
  const safetyBuffer = 60;
  const ttl = Math.min(
    Math.max(credLifeSeconds - safetyBuffer, 0),
    requestedDurationSeconds,
  );
  return ttl;
}

function readCache(cacheKey: string): AWSOIDCredentials | null {
  const entry = credentialCache.get(cacheKey);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    credentialCache.delete(cacheKey);
    return null;
  }
  // LRU: move to end
  credentialCache.delete(cacheKey);
  credentialCache.set(cacheKey, entry);
  return entry.creds;
}

function writeCache(
  cacheKey: string,
  creds: AWSOIDCredentials,
  ttlSeconds: number,
): void {
  if (ttlSeconds <= 0) return;
  const expiresAt = Date.now() + ttlSeconds * 1000;
  credentialCache.set(cacheKey, { creds, expiresAt });
  // Evict oldest if over budget.
  while (credentialCache.size > CACHE_MAX_ENTRIES) {
    const firstKey = credentialCache.keys().next().value;
    if (firstKey === undefined) break;
    credentialCache.delete(firstKey);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Exchange an Azure AD ID token for short-lived AWS credentials via
 * STS::AssumeRoleWithWebIdentity. Cached per-token for the duration of
 * the returned credentials' useful life.
 */
export async function assumeRoleWithAADToken(
  aadToken: string,
  opts: AssumeRoleOptions = {},
): Promise<AWSOIDCredentials> {
  if (!aadToken || typeof aadToken !== 'string') {
    throw new Error(
      'AWS OIDC federation: aadToken is required (received empty/missing).',
    );
  }

  const roleArn = resolveRoleArn(opts);
  const cacheKey = hashToken(aadToken);

  const cached = readCache(cacheKey);
  if (cached) return cached;

  const region = opts.region || process.env.AWS_REGION || 'us-east-1';
  const durationSeconds = opts.durationSeconds ?? 3600;
  const roleSessionName = deriveRoleSessionName(opts.userEmail);

  const client = getSTSClient(region);
  const command = new AssumeRoleWithWebIdentityCommand({
    RoleArn: roleArn,
    RoleSessionName: roleSessionName,
    WebIdentityToken: aadToken,
    DurationSeconds: durationSeconds,
  });

  let response;
  try {
    response = await client.send(command);
  } catch (err) {
    const e = err as Error & { name?: string };
    const prefix = e?.name ? `${e.name}: ` : '';
    throw new Error(
      `AWS OIDC federation failed — ${prefix}${e?.message || String(err)}`,
    );
  }

  const stsCreds = response?.Credentials;
  if (
    !stsCreds ||
    !stsCreds.AccessKeyId ||
    !stsCreds.SecretAccessKey ||
    !stsCreds.SessionToken ||
    !stsCreds.Expiration
  ) {
    throw new Error(
      'AWS OIDC federation: STS returned no usable credentials — missing fields.',
    );
  }

  const expiration =
    stsCreds.Expiration instanceof Date
      ? stsCreds.Expiration
      : new Date(stsCreds.Expiration as unknown as string);

  const creds: AWSOIDCredentials = {
    accessKeyId: stsCreds.AccessKeyId,
    secretAccessKey: stsCreds.SecretAccessKey,
    sessionToken: stsCreds.SessionToken,
    expiration,
  };

  const ttl = computeCacheTTLSeconds(expiration, durationSeconds);
  writeCache(cacheKey, creds, ttl);

  return creds;
}

/**
 * Test-only: clear the in-memory credential cache. Exported for vitest
 * `beforeEach` hooks so a single test file doesn't leak cache hits into
 * the next test.
 */
export function __clearOIDCCache(): void {
  credentialCache.clear();
  stsClientByRegion.clear();
}
