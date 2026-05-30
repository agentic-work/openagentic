/**
 * TDD regression test for Task 3 (CSI-S3 plan):
 * BlobStorageService must honor STORAGE_BUCKET over BLOB_STORAGE_BUCKET.
 *
 * Context: the helm chart sets STORAGE_BUCKET=openagentic-workspaces across
 * api / code-manager / synth-executor as the canonical bucket env. Historic
 * code in BlobStorageService only read BLOB_STORAGE_BUCKET, silently falling
 * through to the `openagentic-images` literal and writing admin/global
 * blobs to the wrong bucket on every deploy.
 *
 * Fix contract (precedence):
 *   override.bucket > STORAGE_BUCKET > BLOB_STORAGE_BUCKET > 'openagentic-images'
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BlobStorageService } from '../BlobStorageService.js';

const originalEnv = { ...process.env };

describe('BlobStorageService — bucket env precedence (STORAGE_BUCKET > BLOB_STORAGE_BUCKET)', () => {
  beforeEach(() => {
    delete process.env.STORAGE_BUCKET;
    delete process.env.BLOB_STORAGE_BUCKET;
    // pin type=local so minio-specific env resolution is out of scope here
    process.env.BLOB_STORAGE_TYPE = 'local';
  });
  afterEach(() => { process.env = { ...originalEnv }; });

  const makeLogger = () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });

  it('honors STORAGE_BUCKET when it is the only bucket env set', () => {
    process.env.STORAGE_BUCKET = 'openagentic-workspaces';
    const svc = new BlobStorageService(makeLogger());
    expect(svc.getConfig().bucket).toBe('openagentic-workspaces');
  });

  it('falls back to BLOB_STORAGE_BUCKET for backwards compat when STORAGE_BUCKET is unset', () => {
    process.env.BLOB_STORAGE_BUCKET = 'custom-bucket';
    const svc = new BlobStorageService(makeLogger());
    expect(svc.getConfig().bucket).toBe('custom-bucket');
  });

  it('prefers STORAGE_BUCKET over BLOB_STORAGE_BUCKET when both are set', () => {
    process.env.STORAGE_BUCKET = 'foo';
    process.env.BLOB_STORAGE_BUCKET = 'bar';
    const svc = new BlobStorageService(makeLogger());
    expect(svc.getConfig().bucket).toBe('foo');
  });

  it('falls back to the `openagentic-images` literal when neither env is set', () => {
    const svc = new BlobStorageService(makeLogger());
    expect(svc.getConfig().bucket).toBe('openagentic-images');
  });

  it('explicit constructor override beats both env vars', () => {
    process.env.STORAGE_BUCKET = 'env-storage';
    process.env.BLOB_STORAGE_BUCKET = 'env-blob';
    const svc = new BlobStorageService(makeLogger(), { bucket: 'override-bucket' });
    expect(svc.getConfig().bucket).toBe('override-bucket');
  });
});
