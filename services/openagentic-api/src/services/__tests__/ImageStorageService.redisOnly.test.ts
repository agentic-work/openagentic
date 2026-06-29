/**
 * ImageStorageService — redis-only fallback (2026-06-24,
 * generate_image-no-image regression, seam #3).
 *
 * LIVE FAILURE (openagentic default pgvector-only stack): Imagen generated
 * the image bytes, but ImageStorageService.connect() threw on the Milvus gRPC
 * health check (code 14 UNAVAILABLE — Milvus is absent by default per root
 * CLAUDE.md gotcha #7), so storeImage() threw "Not connected to storage" and
 * generate_image returned ok:false. No image_url, nothing rendered.
 *
 * GREEN: when Milvus is unavailable but Redis is, connect() enters redis-only
 * mode (connected=true) and store/get round-trip through a durable Redis key.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

// Stub the heavy constructor deps so we can unit-test the redis-only path.
const milvusCheckHealth = vi.fn();
vi.mock('@zilliz/milvus2-sdk-node', () => ({
  MilvusClient: class {
    checkHealth = (...a: any[]) => milvusCheckHealth(...a);
  },
  DataType: {},
}));
vi.mock('../BlobStorageService.js', () => ({
  BlobStorageService: class {
    init = vi.fn().mockResolvedValue(undefined);
    getConfig = () => ({ type: 'local' });
    generateKey = () => 'k';
    store = vi.fn();
    delete = vi.fn();
    getBase64 = vi.fn();
  },
}));
vi.mock('../UniversalEmbeddingService.js', () => ({
  UniversalEmbeddingService: class {
    getInfo = () => ({ dimensions: 768 });
  },
}));

function makeRedis() {
  const store = new Map<string, any>();
  return {
    set: vi.fn(async (k: string, v: any, _ttl?: number) => {
      store.set(k, v);
      return true;
    }),
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    del: vi.fn(async (k: string) => {
      store.delete(k);
      return true;
    }),
    _store: store,
  };
}

const LOGGER: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => LOGGER };
// 1x1 transparent PNG (base64) — real PNG magic bytes (iVBORw0KGgo == 0x89504e47).
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describe('ImageStorageService — redis-only fallback (no Milvus)', () => {
  beforeEach(() => {
    milvusCheckHealth.mockReset();
  });

  test('connect() enters redis-only mode when Milvus is unavailable but Redis is present', async () => {
    const { ImageStorageService } = await import('../ImageStorageService.js');
    milvusCheckHealth.mockRejectedValue(new Error('14 UNAVAILABLE: No connection established'));
    const redis = makeRedis();
    const svc = new ImageStorageService(LOGGER, undefined, redis);
    await expect(svc.connect()).resolves.toBeUndefined();
    expect(svc.isConnected()).toBe(true);
  });

  test('store + get round-trip through Redis with PNG magic-byte integrity', async () => {
    const { ImageStorageService } = await import('../ImageStorageService.js');
    milvusCheckHealth.mockRejectedValue(new Error('14 UNAVAILABLE'));
    const redis = makeRedis();
    const svc = new ImageStorageService(LOGGER, undefined, redis);
    await svc.connect();

    const id = await svc.storeImage(PNG_B64, 'a red circle on a white background', 'user-1', {
      model: 'imagen-4.0-fast-generate-001',
      format: 'png',
    });
    expect(id).toMatch(/^img_/);
    expect(redis.set).toHaveBeenCalledOnce();

    const got = await svc.getImage(id);
    expect(got).not.toBeNull();
    expect(got!.imageData).toBe(PNG_B64);
    expect(got!.metadata.model).toBe('imagen-4.0-fast-generate-001');
    // Decode the stored base64 and assert real PNG magic bytes.
    const bytes = Buffer.from(got!.imageData, 'base64');
    expect(bytes.readUInt32BE(0)).toBe(0x89504e47);
  });

  test('connect() still throws when NEITHER Milvus NOR Redis is available', async () => {
    const { ImageStorageService } = await import('../ImageStorageService.js');
    milvusCheckHealth.mockRejectedValue(new Error('14 UNAVAILABLE'));
    const svc = new ImageStorageService(LOGGER, undefined, undefined); // no redis
    await expect(svc.connect()).rejects.toThrow();
    expect(svc.isConnected()).toBe(false);
  });
});
