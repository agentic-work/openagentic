/**
 * UserStorageService — facade for per-user MinIO bucket ops used by
 * codemode workspaces (`ws-<userIdHash>`). Manages a bucket-per-user + a
 * MinIO user with a scoped policy + a k8s Secret with creds.
 * `hashUserId` MUST match the cm-side hash (Tasks 5 + 9 reuse it).
 * MinIO admin surface is injected as `adminOps`; concrete axios+sigv4
 * impl deferred to Task 5.
 */

import crypto from 'crypto';
import { promises as dnsPromises } from 'dns';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The minimal slice of the `minio.Client` interface this service uses.
 * `minio.Client` already conforms to this shape.
 */
export interface MinioClientSurface {
  bucketExists(bucket: string): Promise<boolean>;
  makeBucket(bucket: string, region?: string): Promise<void>;
  setBucketPolicy(bucket: string, policyJSON: string): Promise<void>;
  putObject(bucket: string, key: string, data: Buffer, size: number, meta?: Record<string, string>): Promise<{ etag: string }>;
  getObject(bucket: string, key: string): Promise<NodeJS.ReadableStream>;
  removeObject(bucket: string, key: string): Promise<void>;
  listObjectsV2(bucket: string, prefix: string, recursive: boolean): AsyncIterable<{ name: string; size: number; lastModified: Date }>;
  /**
   * AC-D4 — issue a presigned GET URL with the given TTL (seconds).
   * `minio.Client.presignedGetObject` already conforms.
   */
  presignedGetObject(bucket: string, key: string, expires?: number): Promise<string>;
}

/**
 * MinIO Admin API surface. `minio-js` does NOT expose these directly; the
 * production implementation hits `/minio/admin/v3/*` with SigV4. Tests
 * stub it entirely.
 */
export interface MinioAdminOps {
  createUser(accessKey: string, secretKey: string): Promise<void>;
  userExists(accessKey: string): Promise<boolean>;
  putPolicy(name: string, policyJSON: string): Promise<void>;
  attachUserPolicy(accessKey: string, policyName: string): Promise<void>;
}

export interface K8sSecretSpec { name: string; namespace: string; data: Record<string, string>; }

/**
 * K8s Secret writer surface. `write()` upserts; `exists()` probes so the
 * fast path can re-write a dropped Secret after a prior partial-fail run.
 */
export interface K8sSecretWriter {
  write(secret: K8sSecretSpec): Promise<void>;
  exists(name: string, namespace: string): Promise<boolean>;
}

export interface UserStorageDeps {
  minioClient: MinioClientSurface;
  /**
   * S3 endpoint URL (e.g. `http://usermin-minio.<namespace>.svc.cluster.local:9000`).
   * Required in root-creds mode — written verbatim into the csi-s3 node-stage
   * Secret under the `endpoint` key.
   */
  storageEndpoint?: string;
  /**
   * MinIO admin ops (create user/policy/attach). Optional. When set, the service
   * creates a per-user MinIO IAM user with a bucket-scoped policy. When unset,
   * the k8s Secret receives the MinIO ROOT creds (see `rootAccessKey` /
   * `rootSecretKey`). Isolation in that mode comes from CSI-S3 mounting only the
   * user's bucket into their exec pod — the Secret is consumed by the CSI
   * driver in kube-system, NOT mounted into the user's pod, so the creds are
   * never readable by user code.
   *
   * The admin-ops path was broken 2026-04-24: the axios SigV4 impl sent
   * plaintext JSON to `/minio/admin/v3/add-user`, which modern MinIO rejects
   * with HTTP 426 ("Upgrade Required"). Correct impl needs madmin argon2id +
   * sio-go encrypted payloads (tracked as a follow-up).
   */
  adminOps?: MinioAdminOps;
  k8sSecretWriter?: K8sSecretWriter;
  /**
   * Resolve a hostname to its A records. Injectable for tests; defaults to
   * `dns.promises.resolve4`. Used to convert the configured cluster-DNS
   * `storageEndpoint` into a host-reachable ClusterIP before it is written
   * into the csi-s3 node-stage Secret — see `resolveHostReachableEndpoint`.
   */
  endpointResolver?: (host: string) => Promise<string[]>;
  /** MinIO root access key — required when `adminOps` is unset. */
  rootAccessKey?: string;
  /** MinIO root secret key — required when `adminOps` is unset. */
  rootSecretKey?: string;
  logger: {
    info: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
    debug: (...a: unknown[]) => void;
  };
  /** Namespace for the generated k8s Secret. REQUIRED — pass `featureFlags.k8sNamespace`. */
  namespace: string;
}

export interface UserBucketInfo { bucketName: string; minioUser: string; secretName: string; }
export interface UserBlobMetadata { bucketName: string; category: string; key: string; size: number; etag: string; }

// ---------------------------------------------------------------------------
// Pure helpers (exported — downstream tasks re-import these)
// ---------------------------------------------------------------------------

// Intended categories (Task 4 writers): `artifacts` | `images` | `uploads` | `legacy`. Widen deliberately.
const CATEGORY_RE = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * sha256 of the userId, truncated to 12 hex chars. MUST match the cm-side
 * hash in k8sSessionManager.ensureUserPVC exactly — csi-s3 reads the
 * node-stage Secret via the `${pvc.name}-creds` template, so bucket Secret
 * name must equal PVC name + "-creds" or the mount times out. See Tasks
 * 5 + 9 which reuse this.
 */
export function hashUserId(userId: string): string {
  if (typeof userId !== 'string' || userId.length === 0) {
    throw new Error('hashUserId: userId must be a non-empty string');
  }
  return crypto.createHash('sha256').update(userId).digest('hex').slice(0, 12);
}

export function bucketNameForUser(userId: string): string {
  return `ws-${hashUserId(userId)}`;
}

export function minioUserForUser(userId: string): string {
  return `u-${hashUserId(userId)}`;
}

function validateCategory(category: string): void {
  if (typeof category !== 'string' || !CATEGORY_RE.test(category)) {
    throw new Error(
      `UserStorageService: category "${category}" must match ${CATEGORY_RE}`
    );
  }
}

function buildUserPolicy(bucketName: string): string {
  return JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['s3:*'],
        Resource: [
          `arn:aws:s3:::${bucketName}`,
          `arn:aws:s3:::${bucketName}/*`,
        ],
      },
      {
        // Deny cross-bucket access. The `NotResource` pattern excludes the
        // user's own bucket; everything else is denied.
        Effect: 'Deny',
        Action: ['s3:*'],
        NotResource: [
          `arn:aws:s3:::${bucketName}`,
          `arn:aws:s3:::${bucketName}/*`,
        ],
      },
    ],
  });
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks);
}

/**
 * Convert a cluster-DNS S3 endpoint into a host-reachable ClusterIP endpoint.
 *
 * WHY: the csi-s3 (yandex) driver mounts each PVC by launching geesefs as a
 * transient systemd unit on the NODE HOST. The host network namespace does not
 * use cluster DNS (CoreDNS), so `openagentic-minio.<ns>.svc.cluster.local` —
 * and the bare `openagentic-minio` — both resolve via the host's upstream
 * resolver to a public IP (observed: 72.75.224.129) → `connection refused` →
 * `Timeout waiting for mount`. The api pod, by contrast, CAN resolve cluster
 * DNS, so it resolves the configured hostname to the Service ClusterIP (which
 * IS reachable from the host net ns) and writes THAT into the node-stage
 * Secret. Best-effort: any failure falls back to the verbatim endpoint.
 */
export async function resolveHostReachableEndpoint(
  endpoint: string,
  resolve4: (host: string) => Promise<string[]>,
  logger?: { warn: (...a: unknown[]) => void },
): Promise<string> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return endpoint;
  }
  const host = url.hostname;
  // Already an IP literal (IPv4 or IPv6) — host can reach it directly.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':')) {
    return endpoint;
  }
  try {
    const ips = await resolve4(host);
    const ip = ips?.[0];
    if (ip) {
      const port = url.port ? `:${url.port}` : '';
      const path = url.pathname && url.pathname !== '/' ? url.pathname : '';
      return `${url.protocol}//${ip}${port}${path}`;
    }
  } catch (e) {
    logger?.warn(
      { host, endpoint, err: e instanceof Error ? e.message : String(e) },
      '[USER-STORAGE] endpoint DNS resolution failed; using hostname verbatim (geesefs mount may fail if host cannot resolve cluster DNS)',
    );
  }
  return endpoint;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class UserStorageService {
  private readonly minio: MinioClientSurface;
  private readonly admin: MinioAdminOps | undefined;
  private readonly secretWriter: K8sSecretWriter | undefined;
  private readonly rootAccessKey: string | undefined;
  private readonly rootSecretKey: string | undefined;
  private readonly storageEndpoint: string | undefined;
  private readonly endpointResolver: (host: string) => Promise<string[]>;
  private readonly logger: UserStorageDeps['logger'];
  private readonly namespace: string;

  constructor(deps: UserStorageDeps) {
    this.minio = deps.minioClient;
    this.admin = deps.adminOps;
    this.secretWriter = deps.k8sSecretWriter;
    this.rootAccessKey = deps.rootAccessKey;
    this.rootSecretKey = deps.rootSecretKey;
    this.storageEndpoint = deps.storageEndpoint;
    this.endpointResolver = deps.endpointResolver ?? ((host) => dnsPromises.resolve4(host));
    this.logger = deps.logger;
    // Namespace MUST be supplied by caller (typically `featureFlags.k8sNamespace`).
    // No fallback: a wrong default would silently scope the user-bucket Secret
    // into the wrong tenant namespace. See feedback_no_hardcoded_namespaces.md.
    if (!deps.namespace) {
      throw new Error('UserStorageService: deps.namespace is required (pass featureFlags.k8sNamespace)');
    }
    this.namespace = deps.namespace;
  }

  /**
   * Idempotent. Ensures bucket exists + k8s Secret with MinIO creds is written.
   *
   * Two modes:
   *  - adminOps present (full IAM isolation): create per-user MinIO IAM user +
   *    bucket-scoped policy + Secret with that user's creds. Blocked today by
   *    the madmin encryption requirement on modern MinIO (see UserStorageDeps
   *    docs).
   *  - adminOps absent (root-creds mode, the current path): write the MinIO
   *    ROOT creds into the k8s Secret. Isolation is via CSI-S3 mounting only
   *    the user's bucket. The Secret is consumed by the CSI driver in
   *    kube-system; it is NOT mounted into the user's exec pod, so the user
   *    cannot read the creds at runtime.
   */
  async ensureUserBucket(userId: string): Promise<UserBucketInfo> {
    const bucketName = bucketNameForUser(userId);
    const minioUser = minioUserForUser(userId);
    const secretName = `${bucketName}-creds`;

    // In root-creds mode the csi-s3 provisioner creates its own bucket per PVC
    // (named `pvc-<uuid>`) when the PVC first binds. Pre-creating `ws-<hash>`
    // in api would leave an orphan bucket — csi-s3 ignores it entirely.
    // Only pre-create the bucket in IAM mode, where the bucket name is what
    // the per-user IAM policy scopes Allow/Deny on.
    if (this.admin) {
      const bucketExists = await this.minio.bucketExists(bucketName);
      if (!bucketExists) {
        try {
          await this.step('makeBucket', userId, () => this.minio.makeBucket(bucketName));
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (code !== 'BucketAlreadyOwnedByYou' && code !== 'BucketAlreadyExists') {
            throw e;
          }
        }
      }
      return this.ensureUserBucketWithIAM(userId, bucketName, minioUser, secretName);
    }
    return this.ensureUserBucketWithRootCreds(userId, bucketName, minioUser, secretName);
  }

  private async ensureUserBucketWithRootCreds(
    userId: string,
    bucketName: string,
    minioUser: string,
    secretName: string,
  ): Promise<UserBucketInfo> {
    if (!this.secretWriter) {
      throw new Error(
        'UserStorageService.ensureUserBucket: k8sSecretWriter is required to persist MinIO credentials',
      );
    }
    if (!this.rootAccessKey || !this.rootSecretKey || !this.storageEndpoint) {
      throw new Error(
        'UserStorageService.ensureUserBucket: rootAccessKey + rootSecretKey + storageEndpoint are required when adminOps is unset',
      );
    }
    const secretExists = await this.secretWriter.exists(secretName, this.namespace);
    if (!secretExists) {
      // geesefs runs on the NODE HOST (systemd) where cluster DNS is NXDOMAIN,
      // so resolve the configured hostname to a host-reachable ClusterIP before
      // writing. See resolveHostReachableEndpoint.
      const nodeStageEndpoint = await resolveHostReachableEndpoint(
        this.storageEndpoint!,
        this.endpointResolver,
        this.logger,
      );
      await this.step('writeSecret', userId, () =>
        this.secretWriter!.write({
          name: secretName,
          namespace: this.namespace,
          // yandex-cloud/k8s-csi-s3 node-stage Secret shape: `endpoint`,
          // `accessKeyID`, `secretAccessKey`. Any other keys are ignored by
          // the driver. We don't include `bucket` — the driver derives the
          // bucket name from the PV's volumeHandle (pvc-<uuid>) and creates
          // it on first mount via the admin provisioner Secret.
          data: {
            endpoint: nodeStageEndpoint,
            accessKeyID: this.rootAccessKey!,
            secretAccessKey: this.rootSecretKey!,
          },
        }),
      );
      this.logger.info(
        { bucketName, secretName },
        '[USER-STORAGE] ensureUserBucket: provisioned (root-creds mode; CSI-S3 Secret written)',
      );
    } else {
      this.logger.debug(
        { bucketName, secretName },
        '[USER-STORAGE] ensureUserBucket: already provisioned',
      );
    }
    // Idempotent — seed the per-user subdir marker on every call so existing
    // buckets get backfilled and geesefs presents /workspaces/<userId> as a
    // directory. Best-effort (failure is non-fatal, see ensureUserSubdir).
    await this.ensureUserSubdir(userId, bucketName);
    return { bucketName, minioUser, secretName };
  }

  private async ensureUserBucketWithIAM(
    userId: string,
    bucketName: string,
    minioUser: string,
    secretName: string,
  ): Promise<UserBucketInfo> {
    const admin = this.admin!;
    const policyName = `policy-${bucketName}`;
    const policyJSON = buildUserPolicy(bucketName);
    const userExists = await admin.userExists(minioUser);

    if (userExists) {
      if (this.secretWriter && !(await this.secretWriter.exists(secretName, this.namespace))) {
        const secretKey = UserStorageService.genSecretKey();
        await this.step('createUser', userId, () => admin.createUser(minioUser, secretKey));
        await this.step('writeSecret', userId, () =>
          this.secretWriter!.write({
            name: secretName, namespace: this.namespace,
            data: { accessKey: minioUser, secretKey, bucketName },
          }),
        );
      }
      this.logger.debug({ bucketName, minioUser }, '[USER-STORAGE] ensureUserBucket: already provisioned (IAM mode)');
      await this.ensureUserSubdir(userId, bucketName);
      return { bucketName, minioUser, secretName };
    }

    if (!this.secretWriter) {
      throw new Error(
        'UserStorageService.ensureUserBucket: k8sSecretWriter is required to persist generated MinIO credentials',
      );
    }
    const accessKey = minioUser;
    const secretKey = UserStorageService.genSecretKey();
    await this.step('createUser', userId, () => admin.createUser(accessKey, secretKey));
    await this.step('putPolicy', userId, () => admin.putPolicy(policyName, policyJSON));
    await this.step('attachUserPolicy', userId, () =>
      admin.attachUserPolicy(accessKey, policyName),
    );
    await this.step('writeSecret', userId, () =>
      this.secretWriter!.write({
        name: secretName, namespace: this.namespace,
        data: { accessKey, secretKey, bucketName },
      }),
    );

    this.logger.info(
      { bucketName, minioUser, secretName },
      '[USER-STORAGE] ensureUserBucket: provisioned (IAM mode)',
    );
    await this.ensureUserSubdir(userId, bucketName);
    return { bucketName, minioUser, secretName };
  }

  /**
   * Seed a zero-byte `<userId>/.keep` object inside the bucket so that
   * geesefs presents `/workspaces/<userId>` as a visible directory when the
   * bucket is mounted at `/workspaces` (the CSI-S3 bucket-root mount).
   *
   * Idempotent — S3 putObject is unconditional (last-writer-wins), so calling
   * this on every `ensureUserBucket` invocation is safe and backfills already-
   * provisioned buckets. Best-effort: a putObject failure is logged but does
   * NOT propagate — the bucket + k8s Secret are the critical path.
   */
  private async ensureUserSubdir(userId: string, bucketName: string): Promise<void> {
    const key = `${userId}/.keep`;
    try {
      await this.minio.putObject(bucketName, key, Buffer.alloc(0), 0);
      this.logger.debug(
        { bucketName, key },
        '[USER-STORAGE] ensureUserSubdir: seeded per-user subdir marker',
      );
    } catch (e) {
      this.logger.warn(
        { bucketName, key, err: (e as Error).message },
        '[USER-STORAGE] ensureUserSubdir: failed to seed .keep (non-fatal — bucket still available)',
      );
    }
  }

  /**
   * Put a zero-byte `<userId>/.keep` object into the given bucket so a fresh
   * CSI-S3 mount presents the per-user prefix as a directory. Bucket-name
   * agnostic — works for either api-named (ws-<hash>) OR CSI-named
   * (pvc-<uuid>) buckets. Idempotent: existing .keep is overwritten harmlessly.
   * Best-effort: logs but does not throw on S3 failure.
   */
  async seedBucketSubdir(bucket: string, userId: string): Promise<void> {
    if (!bucket || typeof bucket !== 'string') {
      this.logger.warn({ bucket, userId }, '[USER-STORAGE] seedBucketSubdir: bucket must be a non-empty string (skipping)');
      return;
    }
    const key = `${userId}/.keep`;
    try {
      await this.minio.putObject(bucket, key, Buffer.alloc(0), 0);
      this.logger.info({ bucket, userId }, '[USER-STORAGE] seedBucketSubdir: ok');
    } catch (e) {
      this.logger.warn(
        { bucket, userId, key, err: (e as Error).message },
        '[USER-STORAGE] seedBucketSubdir: S3 PutObject failed (non-fatal)',
      );
    }
  }

  /** 32 bytes (64 hex chars) — modern AWS / SOC-2 guidance. */
  private static genSecretKey(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /** Wrap a provisioning step with a structured-error log on rethrow. */
  private async step<T>(
    name: 'makeBucket' | 'setBucketPolicy' | 'createUser' | 'putPolicy' | 'attachUserPolicy' | 'writeSecret',
    userId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    try { return await fn(); }
    catch (e) {
      this.logger.error(
        { userId, step: name, err: (e as Error).message },
        `[USER-STORAGE] ensureUserBucket: ${name} failed`,
      );
      throw e;
    }
  }

  async put(
    userId: string,
    category: string,
    key: string,
    data: Buffer | string,
    contentType?: string,
  ): Promise<UserBlobMetadata> {
    validateCategory(category);
    const bucketName = bucketNameForUser(userId);
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    const objectKey = `${category}/${key}`;
    const meta: Record<string, string> = {};
    if (contentType) meta['Content-Type'] = contentType;

    const { etag } = await this.minio.putObject(bucketName, objectKey, buf, buf.length, meta);
    return { bucketName, category, key, size: buf.length, etag };
  }

  async get(userId: string, category: string, key: string): Promise<Buffer> {
    validateCategory(category);
    const bucketName = bucketNameForUser(userId);
    const stream = await this.minio.getObject(bucketName, `${category}/${key}`);
    return streamToBuffer(stream);
  }

  async list(
    userId: string,
    category: string,
  ): Promise<Array<{ key: string; size: number; lastModified: Date }>> {
    validateCategory(category);
    const bucketName = bucketNameForUser(userId);
    const prefix = `${category}/`;
    const out: Array<{ key: string; size: number; lastModified: Date }> = [];
    for await (const item of this.minio.listObjectsV2(bucketName, prefix, true)) {
      out.push({
        key: item.name.startsWith(prefix) ? item.name.slice(prefix.length) : item.name,
        size: item.size,
        lastModified: item.lastModified,
      });
    }
    return out;
  }

  async delete(userId: string, category: string, key: string): Promise<void> {
    validateCategory(category);
    const bucketName = bucketNameForUser(userId);
    await this.minio.removeObject(bucketName, `${category}/${key}`);
  }

  /**
   * AC-D4 — issue a presigned GET URL for a user's artifact. Used by the
   * synth-executor → api → artifact_emit pipeline so the UI's
   * <DownloadTile> click resolves directly against MinIO without
   * proxying bytes through the api pod.
   *
   * Throws NoSuchKey when the object does not exist (the underlying
   * minio client raises this; we surface it so the api emits a useful
   * audit log instead of a stale URL).
   */
  async getPresignedDownloadUrl(
    userId: string,
    category: string,
    key: string,
    ttlSeconds: number = 3600,
  ): Promise<string> {
    validateCategory(category);
    const bucketName = bucketNameForUser(userId);
    const objectKey = `${category}/${key}`;
    return this.minio.presignedGetObject(bucketName, objectKey, ttlSeconds);
  }
}

/**
 * Concrete `MinioAdminOps` implementation — CSI-S3 T5.
 *
 * MinIO's Admin API (`/minio/admin/v3/*`) requires AWS SigV4 signing
 * against the root credentials. `minio-js` does NOT expose these paths,
 * so we hand-roll with axios + node crypto. No SigV4 lib dep (no `aws4`
 * in api package.json) — the admin surface we care about is three POSTs
 * with a small known shape, not worth pulling a dep for.
 *
 * Endpoints hit:
 *   POST   /minio/admin/v3/add-user?accessKey=<name>        (body = encrypted JSON → plaintext JSON here; MinIO accepts either)
 *   GET    /minio/admin/v3/user-info?accessKey=<name>
 *   POST   /minio/admin/v3/add-canned-policy?name=<policy>  (body = policy JSON)
 *   POST   /minio/admin/v3/idp/builtin/policy/attach        (body = { policies: [...], user: <name> })
 *
 * Security note: the creds injected here are the MinIO ROOT credentials
 * (from helm values). They never leave the api pod.
 */
export function createAxiosMinioAdminOps(
  cfg: {
    endpoint: string;
    accessKey: string;
    secretKey: string;
    region?: string;
  },
  // Axios is passed in so callers can await the dynamic import ONCE at
  // plugin-registration time. Previously this function used `require('axios')`
  // inside its body, which threw `require is not defined` under the ESM
  // build — breaking every ensure-user-bucket call and stalling cm's
  // codemode exec-pod boot. The plugin (codemode.plugin.ts) resolves the
  // module via `await import('axios')` in its async registration body and
  // hands us the default export here.
  deps: { axios: typeof import('axios').default },
): MinioAdminOps {
  const { axios } = deps;
  const region = cfg.region ?? 'us-east-1';
  const endpoint = cfg.endpoint.replace(/\/+$/, '');
  const parsed = new URL(endpoint);

  const SERVICE = 's3';

  function sha256Hex(data: string | Buffer): string {
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  function hmac(key: Buffer | string, data: string): Buffer {
    return crypto.createHmac('sha256', key).update(data).digest();
  }

  function amzDate(): { amzDate: string; dateStamp: string } {
    const d = new Date();
    const iso = d.toISOString().replace(/[:-]|\.\d{3}/g, '');
    return { amzDate: iso, dateStamp: iso.slice(0, 8) };
  }

  function canonicalQueryString(search: string): string {
    if (!search) return '';
    const q = search.startsWith('?') ? search.slice(1) : search;
    return q
      .split('&')
      .filter(Boolean)
      .map((kv) => {
        const [k, v = ''] = kv.split('=');
        return `${encodeURIComponent(decodeURIComponent(k))}=${encodeURIComponent(decodeURIComponent(v))}`;
      })
      .sort()
      .join('&');
  }

  async function signedRequest(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: Buffer = Buffer.alloc(0),
  ): Promise<{ status: number; data: unknown }> {
    const url = new URL(endpoint + path);
    const { amzDate: amz, dateStamp } = amzDate();
    const payloadHash = sha256Hex(body);
    const host = parsed.host;

    const canonicalHeaders =
      `host:${host}\n` +
      `x-amz-content-sha256:${payloadHash}\n` +
      `x-amz-date:${amz}\n`;
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

    const canonicalRequest =
      `${method}\n` +
      `${url.pathname}\n` +
      `${canonicalQueryString(url.search)}\n` +
      `${canonicalHeaders}\n` +
      `${signedHeaders}\n` +
      `${payloadHash}`;

    const credentialScope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
    const stringToSign =
      `AWS4-HMAC-SHA256\n${amz}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

    const kDate = hmac(`AWS4${cfg.secretKey}`, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, SERVICE);
    const kSigning = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    const authorization =
      `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const headers: Record<string, string> = {
      host,
      'x-amz-date': amz,
      'x-amz-content-sha256': payloadHash,
      Authorization: authorization,
    };
    if (body.length > 0) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await axios.request({
      method,
      url: url.toString(),
      headers,
      data: body.length > 0 ? body : undefined,
      validateStatus: () => true,
    });
    return { status: res.status, data: res.data };
  }

  return {
    async createUser(accessKey: string, secretKey: string): Promise<void> {
      const payload = Buffer.from(JSON.stringify({ status: 'enabled', secretKey }));
      const r = await signedRequest(
        'POST',
        `/minio/admin/v3/add-user?accessKey=${encodeURIComponent(accessKey)}`,
        payload,
      );
      if (r.status < 200 || r.status >= 300) {
        throw new Error(`minio add-user ${r.status}`);
      }
    },
    async userExists(accessKey: string): Promise<boolean> {
      const r = await signedRequest(
        'GET',
        `/minio/admin/v3/user-info?accessKey=${encodeURIComponent(accessKey)}`,
      );
      if (r.status === 200) return true;
      if (r.status === 404) return false;
      throw new Error(`minio user-info ${r.status}`);
    },
    async putPolicy(name: string, policyJSON: string): Promise<void> {
      const r = await signedRequest(
        'POST',
        `/minio/admin/v3/add-canned-policy?name=${encodeURIComponent(name)}`,
        Buffer.from(policyJSON),
      );
      if (r.status < 200 || r.status >= 300) {
        throw new Error(`minio add-canned-policy ${r.status}`);
      }
    },
    async attachUserPolicy(accessKey: string, policyName: string): Promise<void> {
      // MinIO v3 attach endpoint: POST /minio/admin/v3/idp/builtin/policy/attach
      // body = { policies: [...], user: <name> }
      const body = Buffer.from(
        JSON.stringify({ policies: [policyName], user: accessKey }),
      );
      const r = await signedRequest(
        'POST',
        '/minio/admin/v3/idp/builtin/policy/attach',
        body,
      );
      if (r.status < 200 || r.status >= 300) {
        throw new Error(`minio policy-attach ${r.status}`);
      }
    },
  };
}
