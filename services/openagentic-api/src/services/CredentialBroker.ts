/**
 * CredentialBroker
 *
 * Turns a user's Azure AD token into short-lived, per-cloud credentials
 * ready to inject into synth-executor's `/execute` credentials field.
 *
 *   brokerFor(userJwt, ['aws','azure','gcp']) → { aws:{…}, azure:{…}, gcp:{…} }
 *
 * Composition:
 *   AWS   → AWSOIDCFederation.assumeRoleWithAADToken (STS session, 1h TTL)
 *   Azure → JWT is already the ARM bearer; pass through with audience check
 *   GCP   → SA JSON from env/config (TODO: WIF token exchange once pool exists)
 *
 * Security guarantees:
 *   - `credentials` never lands on disk, never logged as-is
 *   - `redactForAudit` hashes values so audit rows can be safely persisted
 *   - cache keyed by (user-oid, cloud-set) with TTL; no cross-user leakage
 */

import crypto from 'crypto';
import {
  assumeRoleWithAADToken,
  deriveRoleSessionName,
  type AWSOIDCredentials,
} from './llm-providers/AWSOIDCFederation.js';

// ---------------------------------------------------------------------------
// Public types + errors
// ---------------------------------------------------------------------------

export type CloudTarget = 'aws' | 'azure' | 'gcp';

export interface AWSCredentialEnv {
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_SESSION_TOKEN: string;
  AWS_DEFAULT_REGION: string;
}

export interface AzureCredentialEnv {
  AZURE_ACCESS_TOKEN: string;
}

export interface GCPCredentialEnv {
  GOOGLE_SA_JSON: string;
}

export interface BrokeredCredentials {
  aws?: AWSCredentialEnv;
  azure?: AzureCredentialEnv;
  gcp?: GCPCredentialEnv;
}

export class InvalidJwtError extends Error {
  name = 'InvalidJwtError';
}

export class UnknownCloudError extends Error {
  name = 'UnknownCloudError';
}

export interface CredentialBrokerOptions {
  /** AWS IAM role ARN to assume via OIDC (or fall back to AWS_OBO_ROLE_ARN env). */
  awsRoleArn?: string;
  /** AWS region for STS client. */
  awsRegion?: string;
  /** GCP service-account JSON string (raw JSON, not base64). */
  gcpServiceAccountJson?: string;
  /** Cache TTL in seconds (default 900 = 15 min). */
  cacheTtlSeconds?: number;
  /** Time source (injectable for deterministic tests). */
  now?: () => number;
}

// ---------------------------------------------------------------------------
// JWT parsing (no crypto validation — we trust the upstream auth layer's
// signature check and only pull claims out here)
// ---------------------------------------------------------------------------

interface JwtClaims {
  aud?: string;
  iss?: string;
  exp?: number;
  preferred_username?: string;
  upn?: string;
  oid?: string;
  sub?: string;
}

const ARM_AUDIENCES = new Set([
  'https://management.azure.com',
  'https://management.azure.com/',
]);

function parseJwtClaims(jwt: string): JwtClaims {
  if (!jwt || typeof jwt !== 'string') {
    throw new InvalidJwtError('empty or non-string token');
  }
  const parts = jwt.split('.');
  if (parts.length !== 3) {
    throw new InvalidJwtError('malformed token (expected header.payload.sig)');
  }
  try {
    const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payload) as JwtClaims;
  } catch (err) {
    throw new InvalidJwtError(`could not decode token payload: ${(err as Error).message}`);
  }
}

function userIdFromClaims(claims: JwtClaims): string {
  return claims.oid || claims.sub || claims.preferred_username || claims.upn || 'unknown';
}

function userEmailFromClaims(claims: JwtClaims): string | undefined {
  return claims.preferred_username || claims.upn;
}

// ---------------------------------------------------------------------------
// Broker
// ---------------------------------------------------------------------------

interface CacheEntry {
  credentials: BrokeredCredentials;
  expiresAt: number;
}

const KNOWN_CLOUDS: ReadonlySet<CloudTarget> = new Set(['aws', 'azure', 'gcp']);

export class CredentialBroker {
  private readonly awsRoleArn?: string;
  private readonly awsRegion: string;
  private readonly gcpSaJson?: string;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(opts: CredentialBrokerOptions = {}) {
    this.awsRoleArn = opts.awsRoleArn ?? process.env.AWS_OBO_ROLE_ARN;
    this.awsRegion = opts.awsRegion ?? process.env.AWS_REGION ?? 'us-east-1';
    this.gcpSaJson = opts.gcpServiceAccountJson ?? process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    this.cacheTtlMs = (opts.cacheTtlSeconds ?? 900) * 1000;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Broker credentials for the given user + cloud targets.
   *
   * @param userJwt Azure AD access token from the signed-in user. ARM
   *   audience is required if 'azure' is in `clouds`.
   * @param clouds Which clouds the synthesized code needs to touch.
   */
  async brokerFor(userJwt: string, clouds: CloudTarget[]): Promise<BrokeredCredentials> {
    const claims = parseJwtClaims(userJwt);
    this.assertNotExpired(claims);

    // Validate requested clouds up front so a typo fails fast.
    for (const c of clouds) {
      if (!KNOWN_CLOUDS.has(c)) {
        throw new UnknownCloudError(`unknown cloud target: ${c}`);
      }
    }
    if (clouds.includes('azure')) {
      this.assertArmAudience(claims);
    }

    const cacheKey = this.cacheKey(claims, clouds);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) {
      return cached.credentials;
    }

    const out: BrokeredCredentials = {};
    for (const cloud of clouds) {
      try {
        if (cloud === 'aws') {
          out.aws = await this.brokerAws(userJwt, claims);
        } else if (cloud === 'azure') {
          out.azure = { AZURE_ACCESS_TOKEN: userJwt };
        } else if (cloud === 'gcp') {
          out.gcp = this.brokerGcp();
        }
      } catch (err) {
        throw new Error(`broker failed for cloud=${cloud}: ${(err as Error).message}`);
      }
    }

    this.cache.set(cacheKey, {
      credentials: out,
      expiresAt: this.now() + this.cacheTtlMs,
    });
    return out;
  }

  /** Flattens BrokeredCredentials into a single env-var dict for synth.credentials. */
  toEnv(creds: BrokeredCredentials): Record<string, string> {
    return {
      ...(creds.aws ?? {}),
      ...(creds.azure ?? {}),
      ...(creds.gcp ?? {}),
    };
  }

  /**
   * Produces an audit-safe view: key names preserved, values replaced with
   * `sha256:<first-8-hex>...`. Safe to persist, safe to log.
   */
  redactForAudit(env: Record<string, string>): Record<string, string> {
    const redacted: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      const h = crypto.createHash('sha256').update(v).digest('hex').slice(0, 8);
      redacted[k] = `sha256:${h}...`;
    }
    return redacted;
  }

  /** For tests. */
  __clearCache(): void {
    this.cache.clear();
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async brokerAws(userJwt: string, claims: JwtClaims): Promise<AWSCredentialEnv> {
    const email = userEmailFromClaims(claims);
    const sessionName = deriveRoleSessionName(email);
    const creds: AWSOIDCredentials = await assumeRoleWithAADToken(userJwt, {
      roleArn: this.awsRoleArn,
      region: this.awsRegion,
      userEmail: email,
      // durationSeconds intentionally omitted — upstream default (3600) is fine
    } as Parameters<typeof assumeRoleWithAADToken>[1] & { sessionName: string });

    // Guard against the mock returning no session token (defensive).
    if (!creds.sessionToken) {
      throw new Error('STS returned no session token');
    }

    // sessionName is computed so callers can correlate audit rows; not injected
    // into env (AWS doesn't use it at call time) but kept in the closure for
    // future audit plumbing.
    void sessionName;

    return {
      AWS_ACCESS_KEY_ID: creds.accessKeyId,
      AWS_SECRET_ACCESS_KEY: creds.secretAccessKey,
      AWS_SESSION_TOKEN: creds.sessionToken,
      AWS_DEFAULT_REGION: this.awsRegion,
    };
  }

  private brokerGcp(): GCPCredentialEnv {
    if (!this.gcpSaJson) {
      throw new Error('GCP service account JSON not configured');
    }
    return { GOOGLE_SA_JSON: this.gcpSaJson };
  }

  private assertNotExpired(claims: JwtClaims): void {
    if (typeof claims.exp !== 'number') return; // some tokens omit exp; skip
    const nowSec = Math.floor(this.now() / 1000);
    if (claims.exp < nowSec) {
      throw new InvalidJwtError(`token expired at ${claims.exp} (now ${nowSec})`);
    }
  }

  private assertArmAudience(claims: JwtClaims): void {
    if (!claims.aud || !ARM_AUDIENCES.has(claims.aud)) {
      throw new InvalidJwtError(
        `token audience "${claims.aud}" is not management.azure.com; ` +
          'request an ARM-scoped token before calling Azure cloud targets',
      );
    }
  }

  private cacheKey(claims: JwtClaims, clouds: CloudTarget[]): string {
    const userId = userIdFromClaims(claims);
    const cloudKey = [...clouds].sort().join(',');
    return `${userId}|${cloudKey}`;
  }
}

// ---------------------------------------------------------------------------
// Lazy process-singleton (chatmode-rip Phase C.5 — 2026-05-11)
// ---------------------------------------------------------------------------
//
// Chat dispatch wires the broker via buildChatV2Deps → V3DispatchDeps →
// dispatchSynth. Constructing one broker per request is wasteful (the AWS
// STS cache is per-instance), so we expose a lazy singleton that resolves
// AWS_OBO_ROLE_ARN / AWS_REGION / GOOGLE_APPLICATION_CREDENTIALS_JSON from
// env at FIRST CALL. Tests bypass entirely by injecting a stub broker via
// `BuildChatV2DepsOptions.synthCredentialBroker`; production wires the
// singleton via this getter.

let singletonInstance: CredentialBroker | null = null;

/**
 * Lazy process-singleton getter for the CredentialBroker.
 *
 * Constructed on first call from process env (AWS_OBO_ROLE_ARN,
 * AWS_REGION, GOOGLE_APPLICATION_CREDENTIALS_JSON). Subsequent calls
 * return the cached instance.
 *
 * Test-only callers should NOT use this — pass an explicit
 * `{ brokerFor: vi.fn() }` stub matching `SynthOBOBrokerLike` instead.
 */
export function getCredentialBroker(): CredentialBroker {
  if (!singletonInstance) {
    singletonInstance = new CredentialBroker();
  }
  return singletonInstance;
}

/** Test-only: clear the singleton so the next call rebuilds from env. */
export function _resetCredentialBrokerForTests(): void {
  singletonInstance = null;
}
