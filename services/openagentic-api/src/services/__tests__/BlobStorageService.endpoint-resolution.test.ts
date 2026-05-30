/**
 * TDD regression test for the "image save hits a public IP" bug.
 *
 * Context: the api pod shipped with `MINIO_ENDPOINT=openagentic-minio:9000`
 * but NO `openagentic-minio` Service exists in this cluster. DNS walked
 * upward to the public resolver and returned a random IP (<a public IP>).
 * Every image generation then failed the Milvus-backed save with
 * ECONNREFUSED and the user saw no image inline.
 *
 * Fix contract:
 *  - BlobStorageService prefers STORAGE_ENDPOINT (canonical helm env) over
 *    MINIO_ENDPOINT.
 *  - STORAGE_ENDPOINT carries a full URL (http://host:port); the config
 *    returned to the Minio client must be host:port (scheme stripped) and
 *    useSSL derived from the scheme.
 *  - MINIO_ENDPOINT still works as a fallback for backwards compatibility.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BlobStorageService } from '../BlobStorageService.js';

const originalEnv = { ...process.env };

describe('BlobStorageService — minio endpoint resolution', () => {
  beforeEach(() => {
    delete process.env.STORAGE_ENDPOINT;
    delete process.env.MINIO_ENDPOINT;
    delete process.env.STORAGE_ACCESS_KEY;
    delete process.env.MINIO_ACCESS_KEY;
    delete process.env.STORAGE_SECRET_KEY;
    delete process.env.MINIO_SECRET_KEY;
    delete process.env.MINIO_USE_SSL;
    process.env.BLOB_STORAGE_TYPE = 'minio';
  });
  afterEach(() => { process.env = { ...originalEnv }; });

  const makeLogger = () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });

  it('prefers STORAGE_ENDPOINT over MINIO_ENDPOINT and strips the http:// scheme', () => {
    process.env.STORAGE_ENDPOINT = 'http://usermin-minio.agentic-dev.svc.cluster.local:9000';
    process.env.MINIO_ENDPOINT = 'openagentic-minio:9000'; // dead service — must NOT win

    const svc = new BlobStorageService(makeLogger());
    const cfg = svc.getConfig();

    expect(cfg.type).toBe('minio');
    expect(cfg.endpoint).toBe('usermin-minio.agentic-dev.svc.cluster.local:9000');
    expect(cfg.useSSL).toBe(false);
  });

  it('honors https:// STORAGE_ENDPOINT by setting useSSL=true and stripping scheme', () => {
    process.env.STORAGE_ENDPOINT = 'https://s3.us-east-1.amazonaws.com';
    const svc = new BlobStorageService(makeLogger());
    const cfg = svc.getConfig();
    expect(cfg.endpoint).toBe('s3.us-east-1.amazonaws.com');
    expect(cfg.useSSL).toBe(true);
  });

  it('falls back to MINIO_ENDPOINT when STORAGE_ENDPOINT is unset', () => {
    process.env.MINIO_ENDPOINT = 'milvus-minio:9000';
    const svc = new BlobStorageService(makeLogger());
    const cfg = svc.getConfig();
    expect(cfg.endpoint).toBe('milvus-minio:9000');
    expect(cfg.useSSL).toBe(false);
  });

  it('prefers STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY over MINIO_* for creds', () => {
    process.env.STORAGE_ENDPOINT = 'http://usermin-minio.agentic-dev.svc.cluster.local:9000';
    process.env.STORAGE_ACCESS_KEY = 'storage-ak';
    process.env.STORAGE_SECRET_KEY = 'storage-sk';
    process.env.MINIO_ACCESS_KEY = 'minio-ak';
    process.env.MINIO_SECRET_KEY = 'minio-sk';

    const svc = new BlobStorageService(makeLogger());
    const cfg: any = svc.getConfig();
    expect(cfg.accessKey).toBe('storage-ak');
    expect(cfg.secretKey).toBe('storage-sk');
  });

  it('never returns a reference to a non-existent `openagentic-minio` default when STORAGE_ENDPOINT is set', () => {
    // The original bug: default of `openagentic-minio:9000` in the code path.
    // With STORAGE_ENDPOINT set, the result MUST be the usermin-minio host,
    // not the dead default, regardless of what MINIO_ENDPOINT contains.
    process.env.STORAGE_ENDPOINT = 'http://usermin-minio.agentic-dev.svc.cluster.local:9000';
    process.env.MINIO_ENDPOINT = 'openagentic-minio:9000';

    const svc = new BlobStorageService(makeLogger());
    const cfg = svc.getConfig();
    expect(cfg.endpoint).not.toBe('openagentic-minio:9000');
    expect(cfg.endpoint).not.toContain('openagentic-minio');
  });
});
