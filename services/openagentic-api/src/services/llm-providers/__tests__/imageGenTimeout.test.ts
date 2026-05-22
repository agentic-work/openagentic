/**
 * generate_image was hanging 3+ minutes in chat. Root cause: the
 * Promise.race in ProviderManager.generateImage() used
 * `this.config.failoverTimeout` — the SAME budget that governs chat
 * completions. LLM_FAILOVER_TIMEOUT defaults to 30s, tuned for
 * streaming text; DALL-E / Imagen inference is 15-30s of pure wall
 * clock, plus embedding + Milvus insert + MinIO upload. A single image
 * gen reliably blows the 30s budget and cascades through failover.
 *
 * Contract: image gen must use a SEPARATE, LARGER budget —
 * `imageGenTimeout`, env-tunable via `LLM_IMAGE_GEN_TIMEOUT`, default
 * 180000ms (3 min). failoverTimeout stays 30s for chat.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from 'pino';

vi.mock('../../../utils/prisma.js', () => {
  const mock = {
    lLMProvider: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
  (globalThis as any).__prismaMockImageGen = mock;
  return { prisma: mock };
});

import '../../../utils/prisma.js';
import { ProviderConfigService } from '../ProviderConfigService.js';

const silentLogger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
  child: () => silentLogger,
} as unknown as Logger;

describe('ProviderManagerConfig — imageGenTimeout separate from failoverTimeout', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.LLM_IMAGE_GEN_TIMEOUT;
    delete process.env.LLM_FAILOVER_TIMEOUT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('defaults imageGenTimeout to 180000ms (3 min), independent of failoverTimeout', async () => {
    const svc = new ProviderConfigService(silentLogger);
    const cfg = await svc.loadProviderConfig();

    expect(cfg.imageGenTimeout).toBe(180_000);
    // failoverTimeout stays at its own default — changing one must not
    // change the other.
    expect(cfg.failoverTimeout).toBe(30_000);
  });

  it('reads imageGenTimeout from LLM_IMAGE_GEN_TIMEOUT env override', async () => {
    process.env.LLM_IMAGE_GEN_TIMEOUT = '240000';

    const svc = new ProviderConfigService(silentLogger);
    const cfg = await svc.loadProviderConfig();

    expect(cfg.imageGenTimeout).toBe(240_000);
  });

  it('env override on failoverTimeout does NOT affect imageGenTimeout', async () => {
    process.env.LLM_FAILOVER_TIMEOUT = '5000'; // tightened chat timeout
    // imageGenTimeout env unset → keeps default

    const svc = new ProviderConfigService(silentLogger);
    const cfg = await svc.loadProviderConfig();

    expect(cfg.failoverTimeout).toBe(5_000);
    expect(cfg.imageGenTimeout).toBe(180_000);
  });

  it('imageGenTimeout must be a positive integer (validation)', async () => {
    process.env.LLM_IMAGE_GEN_TIMEOUT = '0';

    const svc = new ProviderConfigService(silentLogger);

    // zero or negative is nonsensical — either throws or falls back to default.
    // Contract: throws so misconfig surfaces at boot, not at first image gen.
    await expect(svc.loadProviderConfig()).rejects.toThrow(/IMAGE_GEN_TIMEOUT|imageGenTimeout/i);
  });
});
