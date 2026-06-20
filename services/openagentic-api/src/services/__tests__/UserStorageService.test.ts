/**
 * UserStorageService — TDD spec. Hand-rolled fakes (no minio-mock) so
 * we exercise real UserStorageService behavior, not library internals.
 */

import { describe, it, expect, vi } from 'vitest';
import { Readable } from 'stream';

import {
  UserStorageService,
  hashUserId,
  bucketNameForUser,
  minioUserForUser,
  resolveHostReachableEndpoint,
  type MinioAdminOps,
  type MinioClientSurface,
  type K8sSecretWriter,
} from '../UserStorageService.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

interface FakeBucket {
  policy?: string;
  objects: Map<string, { data: Buffer; etag: string; lastModified: Date }>;
}

function makeFakeMinio() {
  const buckets = new Map<string, FakeBucket>();
  let etagCounter = 0;

  const client: MinioClientSurface = {
    async bucketExists(bucket: string): Promise<boolean> {
      return buckets.has(bucket);
    },
    async makeBucket(bucket: string, _region?: string): Promise<void> {
      if (buckets.has(bucket)) {
        const e = new Error('BucketAlreadyOwnedByYou');
        (e as any).code = 'BucketAlreadyOwnedByYou';
        throw e;
      }
      buckets.set(bucket, { objects: new Map() });
    },
    async setBucketPolicy(bucket: string, policyJSON: string): Promise<void> {
      const b = buckets.get(bucket);
      if (!b) throw new Error('NoSuchBucket');
      b.policy = policyJSON;
    },
    async putObject(
      bucket: string,
      key: string,
      data: Buffer,
      _size: number,
      _meta?: Record<string, string>
    ): Promise<{ etag: string }> {
      const b = buckets.get(bucket);
      if (!b) throw new Error('NoSuchBucket');
      const etag = `etag-${++etagCounter}`;
      b.objects.set(key, { data, etag, lastModified: new Date() });
      return { etag };
    },
    async getObject(bucket: string, key: string): Promise<NodeJS.ReadableStream> {
      const b = buckets.get(bucket);
      if (!b) throw new Error('NoSuchBucket');
      const o = b.objects.get(key);
      if (!o) {
        const e = new Error('NoSuchKey');
        (e as any).code = 'NoSuchKey';
        throw e;
      }
      return Readable.from(o.data);
    },
    async removeObject(bucket: string, key: string): Promise<void> {
      const b = buckets.get(bucket);
      if (!b) throw new Error('NoSuchBucket');
      b.objects.delete(key);
    },
    listObjectsV2(
      bucket: string,
      prefix: string,
      _recursive: boolean
    ): AsyncIterable<{ name: string; size: number; lastModified: Date }> {
      const b = buckets.get(bucket);
      async function* gen() {
        if (!b) return;
        for (const [name, o] of b.objects.entries()) {
          if (name.startsWith(prefix)) {
            yield { name, size: o.data.length, lastModified: o.lastModified };
          }
        }
      }
      return gen();
    },
    async presignedGetObject(
      bucket: string,
      key: string,
      expires?: number,
    ): Promise<string> {
      const b = buckets.get(bucket);
      if (!b) throw new Error('NoSuchBucket');
      if (!b.objects.has(key)) {
        const e = new Error('NoSuchKey');
        (e as any).code = 'NoSuchKey';
        throw e;
      }
      const ttl = typeof expires === 'number' ? expires : 3600;
      // Fake URL — deterministic, lets tests assert structure.
      return `http://minio.test:9000/${bucket}/${key}?X-Amz-Expires=${ttl}&X-Amz-Signature=fake`;
    },
  };

  return { client, buckets };
}

function makeFakeAdmin() {
  const users = new Map<string, string>(); // accessKey → secretKey
  const policies = new Map<string, string>();
  const userPolicies = new Map<string, string>();

  const ops: MinioAdminOps = {
    async createUser(accessKey: string, secretKey: string): Promise<void> {
      users.set(accessKey, secretKey);
    },
    async userExists(accessKey: string): Promise<boolean> {
      return users.has(accessKey);
    },
    async putPolicy(name: string, policyJSON: string): Promise<void> {
      policies.set(name, policyJSON);
    },
    async attachUserPolicy(accessKey: string, policyName: string): Promise<void> {
      userPolicies.set(accessKey, policyName);
    },
  };

  return { ops, users, policies, userPolicies };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

function makeSecretWriter(opts?: { existing?: Set<string> }) {
  const secrets = new Map<string, Record<string, string>>();
  const existing = opts?.existing ?? new Set<string>();
  const write = vi.fn(async (s: { name: string; namespace: string; data: Record<string, string> }) => {
    secrets.set(`${s.namespace}/${s.name}`, s.data);
    existing.add(`${s.namespace}/${s.name}`);
  });
  const exists = vi.fn(async (name: string, namespace: string) => existing.has(`${namespace}/${name}`));
  const sw: K8sSecretWriter = { write, exists };
  return Object.assign(sw, { write, exists, secrets, existing });
}

function setup(opts?: { noSecretWriter?: boolean; iam?: boolean }) {
  const minio = makeFakeMinio();
  const admin = makeFakeAdmin();
  const secretWriter = makeSecretWriter();
  const logger = makeLogger();
  const iam = opts?.iam ?? false;
  const svc = new UserStorageService({
    minioClient: minio.client,
    adminOps: iam ? admin.ops : undefined,
    rootAccessKey: iam ? undefined : 'ROOT_ACCESS',
    rootSecretKey: iam ? undefined : 'ROOT_SECRET_KEY_ABC123',
    storageEndpoint: iam ? undefined : 'http://minio.test:9000',
    k8sSecretWriter: opts?.noSecretWriter ? undefined : secretWriter,
    // Deterministic: tests must not hit real DNS. A throwing resolver makes
    // resolveHostReachableEndpoint fall back to the verbatim hostname, so the
    // existing `endpoint === 'http://minio.test:9000'` assertions stay green.
    endpointResolver: async () => {
      throw new Error('test-no-dns');
    },
    logger,
    namespace: 'openagentic',
  });
  return { svc, minio, admin, secretWriter, logger };
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('hashUserId', () => {
  it('returns the same hash for the same input (stability)', () => {
    expect(hashUserId('alice@example.com')).toBe(hashUserId('alice@example.com'));
  });

  it('returns different hashes for different inputs', () => {
    expect(hashUserId('alice@example.com')).not.toBe(hashUserId('bob@example.com'));
  });

  it('throws on empty string', () => {
    expect(() => hashUserId('')).toThrow(/userId/);
  });

  it('outputs a 12-char lowercase hex string (must match cm PVC hash)', () => {
    const h = hashUserId('some-user-id-42');
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });

  it('handles special chars without throwing', () => {
    const h = hashUserId('user+test@例え.テスト');
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });
});

// resolveHostReachableEndpoint — geesefs runs on the HOST via systemd, where
// cluster DNS (*.svc.cluster.local) is NXDOMAIN. The node-stage Secret endpoint
// MUST be a host-reachable ClusterIP, so the api (which CAN resolve cluster DNS)
// resolves the configured hostname to an IP at write time. Root cause of the
// recurring "Timeout waiting for mount" on codemode exec pods.
describe('resolveHostReachableEndpoint', () => {
  it('resolves a cluster DNS host to its ClusterIP', async () => {
    const out = await resolveHostReachableEndpoint(
      'http://openagentic-minio.openagentic.svc.cluster.local:9000',
      async () => ['10.43.46.174'],
    );
    expect(out).toBe('http://10.43.46.174:9000');
  });

  it('leaves an IP-literal endpoint unchanged and does NOT call the resolver', async () => {
    const resolver = vi.fn(async () => ['1.2.3.4']);
    const out = await resolveHostReachableEndpoint('http://10.43.46.174:9000', resolver);
    expect(out).toBe('http://10.43.46.174:9000');
    expect(resolver).not.toHaveBeenCalled();
  });

  it('returns the original endpoint when DNS resolution fails (best-effort, never throws)', async () => {
    const out = await resolveHostReachableEndpoint(
      'http://openagentic-minio.openagentic.svc.cluster.local:9000',
      async () => {
        throw new Error('ENOTFOUND');
      },
    );
    expect(out).toBe('http://openagentic-minio.openagentic.svc.cluster.local:9000');
  });

  it('returns the original endpoint when the resolver yields an empty list', async () => {
    const out = await resolveHostReachableEndpoint('http://minio:9000', async () => []);
    expect(out).toBe('http://minio:9000');
  });

  it('preserves the port and omits a trailing slash', async () => {
    const out = await resolveHostReachableEndpoint('http://minio:9000', async () => ['10.0.0.5']);
    expect(out).toBe('http://10.0.0.5:9000');
  });
});

describe('bucketNameForUser / minioUserForUser', () => {
  it('bucketNameForUser returns ws-<16hex>', () => {
    const b = bucketNameForUser('alice@example.com');
    expect(b).toMatch(/^ws-[0-9a-f]{12}$/);
  });

  it('minioUserForUser returns u-<16hex>', () => {
    const u = minioUserForUser('alice@example.com');
    expect(u).toMatch(/^u-[0-9a-f]{12}$/);
  });

  it('bucketNameForUser and minioUserForUser share the same hash suffix', () => {
    const b = bucketNameForUser('zed@example.com');
    const u = minioUserForUser('zed@example.com');
    expect(b.slice(3)).toBe(u.slice(2));
  });
});

// ---------------------------------------------------------------------------
// ensureUserBucket
// ---------------------------------------------------------------------------

describe('UserStorageService.ensureUserBucket (root-creds mode — default)', () => {
  it('first call writes Secret with csi-s3 keys (endpoint + accessKeyID + secretAccessKey)', async () => {
    const { svc, minio, secretWriter } = setup();
    const info = await svc.ensureUserBucket('alice@example.com');

    expect(info.bucketName).toBe(bucketNameForUser('alice@example.com'));
    expect(info.minioUser).toBe(minioUserForUser('alice@example.com'));
    expect(info.secretName).toBe(`${info.bucketName}-creds`);
    // Regression: api must NOT pre-create the bucket in root-creds mode.
    // csi-s3 provisions its own bucket per PVC (pvc-<uuid>); a pre-created
    // ws-<hash> bucket would be orphaned.
    expect(minio.buckets.has(info.bucketName)).toBe(false);

    expect(secretWriter.write).toHaveBeenCalledTimes(1);
    const call = secretWriter.write.mock.calls[0][0];
    expect(call.name).toBe(info.secretName);
    expect(call.namespace).toBe('openagentic');
    // Exact csi-s3 node-stage Secret shape — any other keys break the driver.
    expect(Object.keys(call.data).sort()).toEqual(['accessKeyID', 'endpoint', 'secretAccessKey']);
    expect(call.data.endpoint).toBe('http://minio.test:9000');
    expect(call.data.accessKeyID).toBe('ROOT_ACCESS');
    expect(call.data.secretAccessKey).toBe('ROOT_SECRET_KEY_ABC123');
  });

  it('writes the node-stage Secret endpoint as a host-reachable ClusterIP (resolves cluster DNS at write time)', async () => {
    const minio = makeFakeMinio();
    const secretWriter = makeSecretWriter();
    const logger = makeLogger();
    const svc = new UserStorageService({
      minioClient: minio.client,
      rootAccessKey: 'ROOT_ACCESS',
      rootSecretKey: 'ROOT_SECRET_KEY_ABC123',
      storageEndpoint: 'http://openagentic-minio.openagentic.svc.cluster.local:9000',
      k8sSecretWriter: secretWriter,
      endpointResolver: async () => ['10.43.46.174'],
      logger,
      namespace: 'openagentic',
    });

    await svc.ensureUserBucket('alice@example.com');

    const call = secretWriter.write.mock.calls[0][0];
    // The csi-s3 driver runs geesefs on the host (systemd); the host cannot
    // resolve *.svc.cluster.local, so the Secret MUST carry the ClusterIP.
    expect(call.data.endpoint).toBe('http://10.43.46.174:9000');
  });

  it('second call is idempotent — Secret present, writer not re-invoked', async () => {
    const { svc, minio, secretWriter } = setup();
    await svc.ensureUserBucket('alice@example.com');
    const makeBucketSpy = vi.spyOn(minio.client, 'makeBucket');
    secretWriter.write.mockClear();

    await svc.ensureUserBucket('alice@example.com');

    expect(makeBucketSpy).not.toHaveBeenCalled();
    expect(secretWriter.write).not.toHaveBeenCalled();
  });

  it('throws if rootAccessKey/rootSecretKey/storageEndpoint are unset', async () => {
    const minio = makeFakeMinio();
    const secretWriter = makeSecretWriter();
    const logger = makeLogger();
    const svc = new UserStorageService({
      minioClient: minio.client,
      k8sSecretWriter: secretWriter,
      logger,
      namespace: 'openagentic',
    });
    await expect(svc.ensureUserBucket('alice@example.com')).rejects.toThrow(
      /rootAccessKey \+ rootSecretKey \+ storageEndpoint/,
    );
  });

  it('throws if k8sSecretWriter is unset', async () => {
    const { svc } = setup({ noSecretWriter: true });
    await expect(svc.ensureUserBucket('alice@example.com')).rejects.toThrow(/k8sSecretWriter/);
  });

  // Regression: MinIO setBucketPolicy rejects IAM-shape JSON (Principal-less)
  // with "invalid Principal {[]}". Observed 2026-04-24 as every codemode login
  // 500ing with setBucketPolicy failed: invalid Principal {[]}.
  it('does not call setBucketPolicy', async () => {
    const { svc, minio } = setup();
    const spy = vi.spyOn(minio.client, 'setBucketPolicy');
    await svc.ensureUserBucket('alice@example.com');
    await svc.ensureUserBucket('alice@example.com');
    expect(spy).not.toHaveBeenCalled();
  });

  // Regression: MinIO admin add-user rejects plaintext JSON with 426
  // ("Upgrade Required"). Observed 2026-04-24 as the second 500 cause after
  // the setBucketPolicy issue was fixed. Root-creds mode must not call any
  // admin ops at all.
  it('does not call any admin ops (createUser/putPolicy/attachUserPolicy)', async () => {
    const { svc, admin } = setup();
    const createSpy = vi.spyOn(admin.ops, 'createUser');
    const putSpy = vi.spyOn(admin.ops, 'putPolicy');
    const attachSpy = vi.spyOn(admin.ops, 'attachUserPolicy');
    await svc.ensureUserBucket('alice@example.com');
    await svc.ensureUserBucket('alice@example.com');
    expect(createSpy).not.toHaveBeenCalled();
    expect(putSpy).not.toHaveBeenCalled();
    expect(attachSpy).not.toHaveBeenCalled();
  });

  it('does not touch makeBucket in root-creds mode', async () => {
    const { svc, minio } = setup();
    const spy = vi.spyOn(minio.client, 'makeBucket');
    await svc.ensureUserBucket('alice@example.com');
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('UserStorageService.ensureUserBucket (IAM mode — opt-in)', () => {
  it('first call creates bucket, user, policy, and writes k8s secret with expected shape', async () => {
    const { svc, minio, admin, secretWriter } = setup({ iam: true });
    const info = await svc.ensureUserBucket('alice@example.com');

    expect(info.bucketName).toBe(bucketNameForUser('alice@example.com'));
    expect(info.minioUser).toBe(minioUserForUser('alice@example.com'));
    expect(info.secretName).toBe(`${info.bucketName}-creds`);
    expect(minio.buckets.has(info.bucketName)).toBe(true);
    expect(admin.users.has(info.minioUser)).toBe(true);
    expect(admin.policies.size).toBe(1);
    const [policyName] = [...admin.policies.entries()][0];
    expect(admin.userPolicies.get(info.minioUser)).toBe(policyName);

    expect(secretWriter.write).toHaveBeenCalledTimes(1);
    const call = secretWriter.write.mock.calls[0][0];
    expect(call.name).toBe(info.secretName);
    expect(call.namespace).toBe('openagentic');
    expect(call.data.accessKey.length).toBeGreaterThan(0);
    // 32-byte hex secret (64 chars) for SOC-2 / modern AWS guidance
    expect(call.data.secretKey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('second call is idempotent — does not re-create bucket or re-write secret', async () => {
    const { svc, minio, admin, secretWriter } = setup({ iam: true });
    await svc.ensureUserBucket('alice@example.com');
    const makeBucketSpy = vi.spyOn(minio.client, 'makeBucket');
    secretWriter.write.mockClear();
    admin.ops.createUser = vi.fn(admin.ops.createUser);

    const info = await svc.ensureUserBucket('alice@example.com');

    expect(info.bucketName).toBe(bucketNameForUser('alice@example.com'));
    expect(makeBucketSpy).not.toHaveBeenCalled();
    expect(secretWriter.write).not.toHaveBeenCalled();
    expect(admin.ops.createUser).not.toHaveBeenCalled();
  });

  it('when bucket exists but user is missing, still creates user + policy (partial-fail recovery)', async () => {
    const { svc, minio, admin, secretWriter } = setup({ iam: true });
    await minio.client.makeBucket(bucketNameForUser('alice@example.com'));

    const info = await svc.ensureUserBucket('alice@example.com');

    expect(admin.users.has(info.minioUser)).toBe(true);
    expect(admin.userPolicies.has(info.minioUser)).toBe(true);
    expect(secretWriter.write).toHaveBeenCalledTimes(1);
  });

  // Tenant-isolation boundary is the PRIMARY security property in IAM mode.
  // Any edit to buildUserPolicy MUST keep Allow scoped EXACTLY to the user's
  // two ARNs and Deny s3:* via NotResource on the same two ARNs.
  it("user policy grants Allow on the user's bucket ONLY and Denies everything else", async () => {
    const { svc, admin } = setup({ iam: true });
    const putPolicySpy = vi.spyOn(admin.ops, 'putPolicy');
    const info = await svc.ensureUserBucket('alice@example.com');
    const parsed = JSON.parse(putPolicySpy.mock.calls[0][1]);
    const allow = parsed.Statement.find((s: any) => s.Effect === 'Allow');
    const deny = parsed.Statement.find((s: any) => s.Effect === 'Deny');
    const expectedArns = [`arn:aws:s3:::${info.bucketName}`, `arn:aws:s3:::${info.bucketName}/*`].sort();

    expect(allow.Action).toEqual(['s3:*']);
    expect(allow.Resource.sort()).toEqual(expectedArns);
    expect(deny.Action).toEqual(['s3:*']);
    expect(deny.NotResource.sort()).toEqual(expectedArns);
  });

  it('logs structured error when createUser fails', async () => {
    const { svc, admin, logger } = setup({ iam: true });
    vi.spyOn(admin.ops, 'createUser').mockRejectedValueOnce(new Error('boom'));
    await expect(svc.ensureUserBucket('alice@example.com')).rejects.toThrow(/boom/);

    expect(logger.error).toHaveBeenCalled();
    expect(logger.error.mock.calls[0][0]).toMatchObject({
      userId: 'alice@example.com',
      step: 'createUser',
      err: 'boom',
    });
  });
});

// ---------------------------------------------------------------------------
// put / get / list / delete
// ---------------------------------------------------------------------------

describe('UserStorageService.put / get round-trip', () => {
  it('round-trips a small buffer and returns a non-empty etag', async () => {
    const { svc } = setup({ iam: true });
    await svc.ensureUserBucket('alice@example.com');
    const payload = Buffer.from('hello world');
    const meta = await svc.put('alice@example.com', 'artifacts', 'hello.txt', payload, 'text/plain');

    expect(meta.bucketName).toBe(bucketNameForUser('alice@example.com'));
    expect(meta.category).toBe('artifacts');
    expect(meta.key).toBe('hello.txt');
    expect(meta.size).toBe(payload.length);
    expect(meta.etag.length).toBeGreaterThan(0);

    const got = await svc.get('alice@example.com', 'artifacts', 'hello.txt');
    expect(got.toString('utf8')).toBe('hello world');
  });

  it('put rejects a category that does not match the regex', async () => {
    const { svc } = setup({ iam: true });
    await svc.ensureUserBucket('alice@example.com');
    await expect(svc.put('alice@example.com', 'Artifacts', 'x', Buffer.from('x'))).rejects.toThrow(/category/);
    await expect(svc.put('alice@example.com', '1bad', 'x', Buffer.from('x'))).rejects.toThrow(/category/);
    await expect(svc.put('alice@example.com', '', 'x', Buffer.from('x'))).rejects.toThrow(/category/);
  });

  it('get throws on not-found', async () => {
    const { svc } = setup({ iam: true });
    await svc.ensureUserBucket('alice@example.com');
    await expect(svc.get('alice@example.com', 'artifacts', 'missing.txt')).rejects.toThrow();
  });
});

describe('UserStorageService.list', () => {
  it('returns correct shape for objects under <category>/', async () => {
    const { svc } = setup({ iam: true });
    await svc.ensureUserBucket('alice@example.com');
    await svc.put('alice@example.com', 'artifacts', 'a.txt', Buffer.from('a'));
    await svc.put('alice@example.com', 'artifacts', 'b.txt', Buffer.from('bb'));
    await svc.put('alice@example.com', 'logs', 'c.txt', Buffer.from('ccc'));

    const items = await svc.list('alice@example.com', 'artifacts');
    expect(items.length).toBe(2);
    expect(items.map((i) => i.key).sort()).toEqual(['a.txt', 'b.txt']);
    for (const i of items) {
      expect(typeof i.size).toBe('number');
      expect(i.lastModified).toBeInstanceOf(Date);
    }
  });
});

describe('UserStorageService.delete', () => {
  it('calls minioClient.removeObject with bucket + <category>/<key>', async () => {
    const { svc, minio } = setup({ iam: true });
    await svc.ensureUserBucket('alice@example.com');
    await svc.put('alice@example.com', 'artifacts', 'doomed.txt', Buffer.from('x'));

    const removeSpy = vi.spyOn(minio.client, 'removeObject');
    await svc.delete('alice@example.com', 'artifacts', 'doomed.txt');

    expect(removeSpy).toHaveBeenCalledWith(bucketNameForUser('alice@example.com'), 'artifacts/doomed.txt');
    expect((await svc.list('alice@example.com', 'artifacts')).length).toBe(0);
  });
});

describe('UserStorageService per-user isolation', () => {
  it("user A's list does not see user B's objects", async () => {
    const { svc, minio } = setup({ iam: true });
    await svc.ensureUserBucket('alice@example.com');
    await svc.ensureUserBucket('bob@example.com');
    await svc.put('alice@example.com', 'artifacts', 'alice-only.txt', Buffer.from('A'));
    await svc.put('bob@example.com', 'artifacts', 'bob-only.txt', Buffer.from('B'));

    const aItems = await svc.list('alice@example.com', 'artifacts');
    const bItems = await svc.list('bob@example.com', 'artifacts');
    expect(aItems.map((i) => i.key)).toEqual(['alice-only.txt']);
    expect(bItems.map((i) => i.key)).toEqual(['bob-only.txt']);
    expect(bucketNameForUser('alice@example.com')).not.toBe(bucketNameForUser('bob@example.com'));
    expect(minio.buckets.size).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// seedBucketSubdir — public bucket-agnostic .keep seeder (A.11)
// ---------------------------------------------------------------------------

describe('UserStorageService.seedBucketSubdir', () => {
  it('puts <userId>/.keep into the given bucket', async () => {
    const { svc, minio } = setup();
    const bucket = 'pvc-2cf188ca-4fb1-4d2f-b7c9-e6e52344d72a';
    await minio.client.makeBucket(bucket);

    await svc.seedBucketSubdir(bucket, 'alice@example.com');

    const b = minio.buckets.get(bucket);
    expect(b).toBeDefined();
    expect(b!.objects.has('alice@example.com/.keep')).toBe(true);
    expect(b!.objects.get('alice@example.com/.keep')!.data.length).toBe(0);
  });

  it('is idempotent — overwriting existing .keep does not error', async () => {
    const { svc, minio } = setup();
    const bucket = 'pvc-idempotent-test';
    await minio.client.makeBucket(bucket);

    await svc.seedBucketSubdir(bucket, 'alice@example.com');
    await svc.seedBucketSubdir(bucket, 'alice@example.com');

    const b = minio.buckets.get(bucket);
    expect(b!.objects.has('alice@example.com/.keep')).toBe(true);
  });

  it('does NOT throw when S3 PutObject rejects (best-effort)', async () => {
    const { svc, minio, logger } = setup();
    const bucket = 'pvc-error-bucket';
    await minio.client.makeBucket(bucket);
    vi.spyOn(minio.client, 'putObject').mockRejectedValueOnce(new Error('AccessDenied'));

    await expect(svc.seedBucketSubdir(bucket, 'alice@example.com')).resolves.not.toThrow();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('works for an arbitrary CSI-named bucket (pvc-<uuid>)', async () => {
    const { svc, minio } = setup();
    const bucket = 'pvc-abc-123-def-456-ghi';
    await minio.client.makeBucket(bucket);

    const putSpy = vi.spyOn(minio.client, 'putObject');
    await svc.seedBucketSubdir(bucket, 'carol@example.com');

    expect(putSpy).toHaveBeenCalledWith(bucket, 'carol@example.com/.keep', expect.any(Buffer), 0);
    const b = minio.buckets.get(bucket);
    expect(b!.objects.has('carol@example.com/.keep')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ensureUserSubdir — per-user .keep seeding (CSI-S3 pod boot fix)
// ---------------------------------------------------------------------------

describe('UserStorageService ensureUserSubdir (.keep seeding)', () => {
  // Root-creds mode: in root-creds mode the bucket is NOT pre-created by the
  // api; csi-s3 creates a pvc-<uuid> bucket. The .keep object is written into
  // the user's named bucket (ws-<hash>) which csi-s3 has already mounted.
  // The api writes <userId>/.keep after the Secret is provisioned so that
  // geesefs presents /workspaces/<userId> as a directory.
  it('ensureUserBucketWithRootCreds puts <userId>/.keep into the bucket', async () => {
    const { svc, minio } = setup();
    const bucketName = bucketNameForUser('alice@example.com');
    // Pre-create the bucket so putObject doesn't fail (simulating csi-s3 having mounted it)
    await minio.client.makeBucket(bucketName);

    await svc.ensureUserBucket('alice@example.com');

    const bucket = minio.buckets.get(bucketName);
    expect(bucket).toBeDefined();
    expect(bucket!.objects.has('alice@example.com/.keep')).toBe(true);
    const keepObj = bucket!.objects.get('alice@example.com/.keep')!;
    expect(keepObj.data.length).toBe(0); // zero-byte marker
  });

  it('ensureUserBucketWithRootCreds is idempotent — calling twice ends with one .keep (no double-write error)', async () => {
    const { svc, minio } = setup();
    const bucketName = bucketNameForUser('alice@example.com');
    await minio.client.makeBucket(bucketName);
    const putSpy = vi.spyOn(minio.client, 'putObject');

    await svc.ensureUserBucket('alice@example.com');
    await svc.ensureUserBucket('alice@example.com');

    // putObject may be called twice (once per call) but the bucket still has exactly one .keep
    const bucket = minio.buckets.get(bucketName);
    expect(bucket!.objects.has('alice@example.com/.keep')).toBe(true);
    // At least one putObject call for the .keep key
    const keepCalls = putSpy.mock.calls.filter((c) => c[1] === 'alice@example.com/.keep');
    expect(keepCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('ensureUserBucketWithIAM puts <userId>/.keep into the bucket', async () => {
    const { svc, minio } = setup({ iam: true });
    const bucketName = bucketNameForUser('alice@example.com');

    await svc.ensureUserBucket('alice@example.com');

    const bucket = minio.buckets.get(bucketName);
    expect(bucket).toBeDefined();
    expect(bucket!.objects.has('alice@example.com/.keep')).toBe(true);
  });

  it('if putObject for .keep throws, ensureUserBucket does not fail (best-effort)', async () => {
    const { svc, minio, logger } = setup();
    const bucketName = bucketNameForUser('alice@example.com');
    await minio.client.makeBucket(bucketName);
    vi.spyOn(minio.client, 'putObject').mockRejectedValueOnce(new Error('permission denied'));

    // Should NOT throw — bucket + Secret are the critical path
    await expect(svc.ensureUserBucket('alice@example.com')).resolves.not.toThrow();
    // Should log the error
    expect(logger.warn).toHaveBeenCalled();
    const warnMsg = logger.warn.mock.calls.map((c: unknown[]) => String(c[0])).join(' ') +
      logger.warn.mock.calls.map((c: unknown[]) => JSON.stringify(c)).join(' ');
    expect(warnMsg.toLowerCase()).toMatch(/keep|subdir|seed/i);
  });
});

// ---------------------------------------------------------------------------
// AC-D4 — getPresignedDownloadUrl
// ---------------------------------------------------------------------------

describe('UserStorageService.getPresignedDownloadUrl — AC-D4', () => {
  it('returns a presigned URL pointing at the user bucket + object key', async () => {
    const { svc } = setup({ iam: true });
    await svc.ensureUserBucket('alice@example.com');
    await svc.put('alice@example.com', 'reports', 'q1.pdf', Buffer.from('pdf-bytes'), 'application/pdf');
    const url = await svc.getPresignedDownloadUrl('alice@example.com', 'reports', 'q1.pdf');
    expect(url).toContain(bucketNameForUser('alice@example.com'));
    expect(url).toContain('reports/q1.pdf');
    expect(url).toContain('X-Amz-Signature');
  });

  it('honors the ttlSeconds argument (default 3600)', async () => {
    const { svc } = setup({ iam: true });
    await svc.ensureUserBucket('alice@example.com');
    await svc.put('alice@example.com', 'reports', 'q1.pdf', Buffer.from('x'), 'application/pdf');
    const url = await svc.getPresignedDownloadUrl('alice@example.com', 'reports', 'q1.pdf', 600);
    expect(url).toContain('X-Amz-Expires=600');
  });

  it('defaults ttlSeconds to 3600 when omitted', async () => {
    const { svc } = setup({ iam: true });
    await svc.ensureUserBucket('alice@example.com');
    await svc.put('alice@example.com', 'reports', 'q1.pdf', Buffer.from('x'), 'application/pdf');
    const url = await svc.getPresignedDownloadUrl('alice@example.com', 'reports', 'q1.pdf');
    expect(url).toContain('X-Amz-Expires=3600');
  });

  it('rejects an invalid category (validateCategory contract)', async () => {
    const { svc } = setup({ iam: true });
    await svc.ensureUserBucket('alice@example.com');
    await expect(
      svc.getPresignedDownloadUrl('alice@example.com', '../../etc/passwd', 'q1.pdf'),
    ).rejects.toThrow();
  });

  it('throws NoSuchKey when the object does not exist', async () => {
    const { svc } = setup({ iam: true });
    await svc.ensureUserBucket('alice@example.com');
    await expect(
      svc.getPresignedDownloadUrl('alice@example.com', 'reports', 'missing.pdf'),
    ).rejects.toThrow(/NoSuchKey/);
  });
});
