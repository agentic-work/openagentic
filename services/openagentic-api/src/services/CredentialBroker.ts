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
import { getGitHubCredentialService } from './GitHubCredentialService.js';
import { getGCPCredentialService, GcpNotConnectedError as GcpServiceNotConnectedError } from './GCPCredentialService.js';

// ---------------------------------------------------------------------------
// Public types + errors
// ---------------------------------------------------------------------------

/** Cloud targets — these are the ones the code-import-vs-capabilities scan
 * in SynthOBODispatcher checks for SDK imports. */
export type CloudTarget = 'aws' | 'azure' | 'gcp';

/** Every credential target the broker can mint creds for. github is NOT a
 * "cloud" (no SDK-import scan) but it IS a run-as-the-user credential. */
export type BrokerTarget = CloudTarget | 'github';

export interface AWSCredentialEnv {
  AWS_ACCESS_KEY_ID: string;
  AWS_SECRET_ACCESS_KEY: string;
  AWS_SESSION_TOKEN: string;
  AWS_DEFAULT_REGION: string;
}

export interface AzureCredentialEnv {
  AZURE_ACCESS_TOKEN: string;
  /**
   * Parsed from the user JWT's `tid` claim. Optional because some tokens omit
   * it; when absent the SoT PlatformCredentialInjector falls back to "".
   * The SoT injector (`synth/core/identity.py::inject_azure_token`) expects
   * BOTH AZURE_ACCESS_TOKEN and AZURE_TENANT_ID — that is the shape this
   * broker produces.
   */
  AZURE_TENANT_ID?: string;
}

export interface GCPCredentialEnv {
  /**
   * The user's OWN short-lived GCP OAuth access token — run-as-them. Minted by
   * GCPCredentialService (per-user OAuth, cloud-platform scope) and injected by
   * the SoT injector (`synth/core/identity.py::inject_gcp_token`). Present on
   * the run-as-user path.
   */
  GOOGLE_OAUTH_ACCESS_TOKEN?: string;
  /**
   * Legacy shared service-account JSON — NOT run-as-the-user. Only emitted when
   * no GCPCredentialService is wired (the pre-OAuth path). Kept optional so the
   * run-as-user path can omit it.
   */
  GOOGLE_SA_JSON?: string;
}

export interface GitHubCredentialEnv {
  /** The user's own stored GitHub OAuth token — run-as-them. */
  GITHUB_TOKEN: string;
}

export interface BrokeredCredentials {
  aws?: AWSCredentialEnv;
  azure?: AzureCredentialEnv;
  gcp?: GCPCredentialEnv;
  github?: GitHubCredentialEnv;
}

export class InvalidJwtError extends Error {
  override name = 'InvalidJwtError';
}

export class UnknownCloudError extends Error {
  override name = 'UnknownCloudError';
}

/**
 * Thrown when GitHub creds are requested but the user has no linked GitHub
 * identity. We NEVER fall back to a shared/app token — that would break the
 * run-as-the-user contract (code would run as the app, not the user).
 */
export class GitHubNotConnectedError extends Error {
  override name = 'GitHubNotConnectedError';
}

/**
 * Thrown when GCP creds are requested but the user has no linked GCP identity.
 * Mirrors GitHubNotConnectedError. We NEVER fall back to the shared SA JSON
 * once a per-user GCPCredentialService is wired — that would break the
 * run-as-the-user contract (code would run as the platform, not the user).
 */
export class GcpNotConnectedError extends Error {
  override name = 'GcpNotConnectedError';
}

/**
 * Minimal surface of GitHubCredentialService the broker needs — injected so
 * tests can stub it without touching prisma. Production wires the real
 * service (`getGitHubCredentialService`). `getValidTokenString(userId)`
 * returns the decrypted token or null when the user has no linked GitHub.
 */
export interface GitHubCredentialServiceLike {
  getValidTokenString(userId: string): Promise<string | null>;
}

/**
 * Minimal surface of GCPCredentialService the broker needs — injected so tests
 * can stub it without touching prisma/google-auth. Production wires the real
 * service (`getGCPCredentialService`). `getValidAccessToken(userId)` returns
 * the user's valid short-lived OAuth token or null when the user has no linked
 * GCP. Mirrors GitHubCredentialServiceLike.
 */
export interface GCPCredentialServiceLike {
  getValidAccessToken(userId: string): Promise<string | null>;
  /** Phase-1c (off by default): true only when both GCP WIF envs are set. */
  isWorkloadIdentityConfigured?(): boolean;
  /** Phase-1c (off by default): Entra→GCP federated, impersonated, read-scoped
   *  token. Returns null when WIF isn't configured. */
  getFederatedAccessToken?(entraSubjectToken: string): Promise<string | null>;
}

export interface CredentialBrokerOptions {
  /** AWS IAM role ARN to assume via OIDC (or fall back to AWS_OBO_ROLE_ARN env). */
  awsRoleArn?: string;
  /** AWS region for STS client. */
  awsRegion?: string;
  /** GCP service-account JSON string (raw JSON, not base64). */
  gcpServiceAccountJson?: string;
  /**
   * GitHub credential service — looks up the user's stored OAuth token by
   * platform userId. Injected (NEVER `new`ed inside) so it is testable and
   * stubbable. When unset, requesting the `github` target throws.
   */
  githubCredentialService?: GitHubCredentialServiceLike;
  /**
   * GCP credential service — looks up the user's stored per-user OAuth token by
   * platform userId. Injected (NEVER `new`ed inside) so it is testable and
   * stubbable. When set, the `gcp` target runs as the user
   * (GOOGLE_OAUTH_ACCESS_TOKEN); when unset, the legacy shared SA JSON path is
   * used instead (if configured).
   */
  gcpCredentialService?: GCPCredentialServiceLike;
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
  /** Azure AD tenant id — needed by the SoT injector's AZURE_TENANT_ID. */
  tid?: string;
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

const KNOWN_TARGETS: ReadonlySet<BrokerTarget> = new Set(['aws', 'azure', 'gcp', 'github']);

export class CredentialBroker {
  private readonly awsRoleArn?: string;
  private readonly awsRegion: string;
  private readonly gcpSaJson?: string;
  private readonly githubCredentialService?: GitHubCredentialServiceLike;
  private readonly gcpCredentialService?: GCPCredentialServiceLike;
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(opts: CredentialBrokerOptions = {}) {
    this.awsRoleArn = opts.awsRoleArn ?? process.env.AWS_OBO_ROLE_ARN;
    this.awsRegion = opts.awsRegion ?? process.env.AWS_REGION ?? 'us-east-1';
    this.gcpSaJson = opts.gcpServiceAccountJson ?? process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
    this.githubCredentialService = opts.githubCredentialService;
    this.gcpCredentialService = opts.gcpCredentialService;
    this.cacheTtlMs = (opts.cacheTtlSeconds ?? 900) * 1000;
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * Broker credentials for the given user + targets (clouds + github).
   *
   * @param userJwt Azure AD access token from the signed-in user. ARM
   *   audience is required if 'azure' is in `targets`.
   * @param targets Which targets the synthesized code needs (aws/azure/gcp/github).
   * @param platformUserId The platform user id (request.user.id / ctx.userId).
   *   REQUIRED for the `github` target — the user's stored GitHub token is
   *   keyed by this id, NOT by the JWT `oid` (unifiedAuth remaps oid→user.id).
   *   Optional for cloud-only requests (aws/azure/gcp don't need it).
   */
  async brokerFor(
    userJwt: string,
    targets: BrokerTarget[],
    platformUserId?: string,
    entraSubjectToken?: string,
  ): Promise<BrokeredCredentials> {
    const claims = parseJwtClaims(userJwt);
    this.assertNotExpired(claims);

    // Validate requested targets up front so a typo fails fast.
    for (const t of targets) {
      if (!KNOWN_TARGETS.has(t)) {
        throw new UnknownCloudError(`unknown cloud target: ${t}`);
      }
    }
    // ARM-audience is required ONLY for the azure target (the user JWT is the
    // ARM bearer). The Phase-1c AWS path feeds the Entra id_token here, whose
    // audience is the app clientId (validated by the IAM OIDC provider), NOT
    // ARM — so a pure ['aws'] request must SKIP the ARM assertion or it would
    // throw InvalidJwtError before assume-role-with-web-identity ever runs.
    if (targets.includes('azure')) {
      this.assertArmAudience(claims);
    }

    const cacheKey = this.cacheKey(claims, targets, platformUserId);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > this.now()) {
      return cached.credentials;
    }

    const out: BrokeredCredentials = {};
    for (const target of targets) {
      try {
        if (target === 'aws') {
          out.aws = await this.brokerAws(userJwt, claims);
        } else if (target === 'azure') {
          out.azure = this.brokerAzure(userJwt, claims);
        } else if (target === 'gcp') {
          out.gcp = await this.brokerGcp(claims, platformUserId, entraSubjectToken);
        } else if (target === 'github') {
          out.github = await this.brokerGithub(claims, platformUserId);
        }
      } catch (err) {
        // Preserve typed broker errors (GitHubNotConnectedError /
        // GcpNotConnectedError) so the dispatcher can surface a precise "link it
        // in settings" message, while still tagging which target failed.
        if (
          err instanceof GitHubNotConnectedError ||
          err instanceof GcpNotConnectedError
        ) {
          throw err;
        }
        throw new Error(`broker failed for cloud=${target}: ${(err as Error).message}`);
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
      ...(creds.github ?? {}),
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

  /**
   * Azure: the user JWT is itself the ARM bearer token (pass-through, audience
   * already validated). We additionally parse the `tid` claim into
   * AZURE_TENANT_ID so the SoT injector (`inject_azure_token`) gets the full
   * shape it expects. The key is OMITTED (not set to undefined) when the token
   * carries no tid — the SoT injector falls back to "" in that case.
   */
  private brokerAzure(userJwt: string, claims: JwtClaims): AzureCredentialEnv {
    const env: AzureCredentialEnv = { AZURE_ACCESS_TOKEN: userJwt };
    if (typeof claims.tid === 'string' && claims.tid.length > 0) {
      env.AZURE_TENANT_ID = claims.tid;
    }
    return env;
  }

  /**
   * GitHub: fetch the user's OWN stored OAuth token (run-as-them). The token
   * is keyed by the platform userId. We NEVER fall back to a shared/app token
   * — if the user hasn't linked GitHub, that's a hard, actionable error.
   */
  private async brokerGithub(
    claims: JwtClaims,
    platformUserId?: string,
  ): Promise<GitHubCredentialEnv> {
    if (!this.githubCredentialService) {
      throw new Error(
        'GitHub credential service not configured — cannot broker github target',
      );
    }
    // Prefer the explicit platform userId (the key the token is stored under).
    // Fall back to the JWT-derived id only if no explicit id was passed; in
    // practice the dispatcher always passes ctx.userId.
    const lookupId = platformUserId ?? userIdFromClaims(claims);
    const token = await this.githubCredentialService.getValidTokenString(lookupId);
    if (!token) {
      throw new GitHubNotConnectedError(
        'GitHub not connected — link it in settings to run tools as your GitHub user.',
      );
    }
    return { GITHUB_TOKEN: token };
  }

  /**
   * GCP: fetch the user's OWN per-user OAuth token (run-as-them), mirroring the
   * github path. When a GCPCredentialService is wired, the token is keyed by
   * the platform userId and returned as GOOGLE_OAUTH_ACCESS_TOKEN — we NEVER
   * fall back to the shared SA JSON in that mode (a not-linked user is a hard,
   * actionable error). Only when NO service is wired do we use the legacy
   * shared SA JSON (the pre-OAuth path), with a loud not-run-as-user warning.
   */
  private async brokerGcp(
    claims: JwtClaims,
    platformUserId?: string,
    entraSubjectToken?: string,
  ): Promise<GCPCredentialEnv> {
    if (this.gcpCredentialService) {
      // Branch 1 (preferred) — per-user OAuth (the user's OWN GCP IAM). Prefer
      // the explicit platform userId (the key the token is stored under). Fall
      // back to the JWT-derived id only if none was passed; in practice the
      // dispatcher always passes ctx.userId.
      const lookupId = platformUserId ?? userIdFromClaims(claims);
      const token = await this.gcpCredentialService.getValidAccessToken(lookupId);
      if (token) {
        return { GOOGLE_OAUTH_ACCESS_TOKEN: token };
      }

      // Branch 2 — Entra→GCP WIF (Phase-1c, OFF unless both
      // GCP_WORKLOAD_IDENTITY_AUDIENCE + SA-email envs are set). Coarser than
      // Branch 1: it runs as an impersonated read-scoped SA with the Entra
      // subject recorded as the federation principal, not the user's own IAM.
      if (
        this.gcpCredentialService.isWorkloadIdentityConfigured?.() &&
        this.gcpCredentialService.getFederatedAccessToken &&
        entraSubjectToken
      ) {
        const wifToken = await this.gcpCredentialService.getFederatedAccessToken(entraSubjectToken);
        if (wifToken) {
          return { GOOGLE_OAUTH_ACCESS_TOKEN: wifToken };
        }
        throw new GcpNotConnectedError(
          'GCP WIF configured but exchange returned nothing — check provider + SA impersonation binding.',
        );
      }

      // Branch 3 — neither connected.
      throw new GcpNotConnectedError(
        'GCP not connected — Connect GCP in settings to run tools as your GCP user.',
      );
    }

    // Legacy shared-SA path (no per-user OAuth service wired). This is NOT
    // run-as-the-user — the code runs as the platform's service account.
    if (this.gcpSaJson) {
      // eslint-disable-next-line no-console
      console.warn(
        '[CredentialBroker] GCP brokered via SHARED service-account JSON — ' +
          'this is NOT run-as-the-user. Wire a GCPCredentialService for per-user OAuth.',
      );
      return { GOOGLE_SA_JSON: this.gcpSaJson };
    }

    throw new Error('GCP service account JSON not configured');
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

  private cacheKey(
    claims: JwtClaims,
    targets: BrokerTarget[],
    platformUserId?: string,
  ): string {
    // Key on BOTH the JWT identity AND the explicit platform userId so a
    // github lookup never serves another user's token from cache, and a
    // cloud-only request stays keyed exactly as before.
    const userId = userIdFromClaims(claims);
    const targetKey = [...targets].sort().join(',');
    return `${userId}|${platformUserId ?? ''}|${targetKey}`;
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
 * Minimal logger shape the GitHubCredentialService needs (`.child()` +
 * level methods). Used as a fallback when no fastify logger is available
 * at singleton-construction time so the chat-dispatch path can still broker
 * GitHub creds.
 */
interface ChildLogger {
  child: (bindings: Record<string, unknown>) => ChildLogger;
  info: (...a: unknown[]) => void;
  warn: (...a: unknown[]) => void;
  error: (...a: unknown[]) => void;
  debug: (...a: unknown[]) => void;
}

function fallbackGithubLogger(): ChildLogger {
  const self: ChildLogger = {
    child: () => self,
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
  return self;
}

/**
 * Lazy process-singleton getter for the CredentialBroker.
 *
 * Constructed on first call from process env (AWS_OBO_ROLE_ARN,
 * AWS_REGION, GOOGLE_APPLICATION_CREDENTIALS_JSON) and wires the
 * GitHubCredentialService so the `github` target can run-as-the-user.
 * Subsequent calls return the cached instance.
 *
 * @param logger Optional fastify logger for the GitHubCredentialService; a
 *   silent fallback is used when omitted (the chat-dispatch wiring path).
 *
 * Test-only callers should NOT use this — pass an explicit
 * `{ brokerFor: vi.fn() }` stub matching `SynthOBOBrokerLike` instead.
 */
export function getCredentialBroker(logger?: unknown): CredentialBroker {
  if (!singletonInstance) {
    let githubCredentialService: GitHubCredentialServiceLike | undefined;
    try {
      // Resolved lazily to avoid a hard module-load coupling; the github
      // service is itself a singleton keyed on first logger.
      githubCredentialService = getGitHubCredentialService(
        (logger ?? fallbackGithubLogger()) as never,
      );
    } catch {
      // If the github service can't construct (no prisma in a unit ctx),
      // leave it unset — requesting `github` then throws a clear error.
      githubCredentialService = undefined;
    }

    let gcpCredentialService: GCPCredentialServiceLike | undefined;
    try {
      // Adapter over the real GCPCredentialService: returns the user's valid
      // OAuth token, or null when the user has not linked GCP — detected BY
      // TYPE (GcpNotConnectedError), never by string match. The service's own
      // getValidAccessToken already does this; the defensive catch keeps the
      // adapter robust if a future getToken path throws the typed error.
      const svc = getGCPCredentialService((logger ?? fallbackGithubLogger()) as never);
      gcpCredentialService = {
        getValidAccessToken: async (uid: string) => {
          try {
            return await svc.getValidAccessToken(uid);
          } catch (e) {
            if (e instanceof GcpServiceNotConnectedError) return null;
            throw e;
          }
        },
        // Phase-1c (off by default): forward the WIF methods so production can
        // take Branch 2 when both GCP WIF envs are set.
        isWorkloadIdentityConfigured: () => svc.isWorkloadIdentityConfigured(),
        getFederatedAccessToken: (t: string) => svc.getFederatedAccessToken(t),
      };
    } catch {
      // If the gcp service can't construct (no prisma in a unit ctx), leave it
      // unset — the broker then falls back to the legacy shared SA JSON path
      // (if GOOGLE_APPLICATION_CREDENTIALS_JSON is configured).
      gcpCredentialService = undefined;
    }

    singletonInstance = new CredentialBroker({
      githubCredentialService,
      gcpCredentialService,
    });
  }
  return singletonInstance;
}

/** Test-only: clear the singleton so the next call rebuilds from env. */
export function _resetCredentialBrokerForTests(): void {
  singletonInstance = null;
}
