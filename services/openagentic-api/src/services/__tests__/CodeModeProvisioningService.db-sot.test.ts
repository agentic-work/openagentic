/**
 * Red-green lock for SoT fix in CodeModeProvisioningService (plan task 5, File 3).
 *
 * Pre-fix code (line ~72 in constructor):
 *   defaultModel: process.env.CODE_MODE_DEFAULT_MODEL || process.env.DEFAULT_MODEL || process.env.FALLBACK_MODEL,
 *
 * Fix (sync constructor context):
 *   Constructor leaves config.defaultModel as undefined.
 *   async resolveDefaultModel(): Promise<string | undefined> reads DB via getDefaultChatModel().
 *   startProvisioning() and provisionOpenagentic() await resolveDefaultModel() instead.
 *
 * Triggering path:
 *   startProvisioning() is public async. It calls prisma.codeModeProvisioning.upsert()
 *   with openagentic_model: this.config.defaultModel (pre-fix) or resolveDefaultModel() (post-fix).
 *   We capture the upsert call args to verify the model value passed.
 *
 * Scenarios:
 *   1. DB default chat model wins over poisoned env
 *   2. — (no "caller-pinned" path at startProvisioning level; the model is purely internal config)
 *      Instead: DB model flows through to the prisma upsert openagentic_model field
 *   3. DB fails → undefined (field is nullable String? in schema — acceptable)
 *
 * Note: Test 2 verifies "no env" path — when env vars are clear and DB returns a model.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../ModelConfigurationService.js', () => ({
  ModelConfigurationService: {
    getDefaultChatModel: vi.fn(),
    getServiceModel: vi.fn(),
  },
}));

import { ModelConfigurationService } from '../ModelConfigurationService.js';
import { CodeModeProvisioningService } from '../CodeModeProvisioningService.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

function makePrisma() {
  return {
    codeModeProvisioning: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'prov-1', status: 'provisioning' }),
      update: vi.fn().mockResolvedValue({ id: 'prov-1', status: 'ready' }),
    },
    user: {
      findUnique: vi.fn().mockResolvedValue({ is_admin: true, code_enabled: true }),
    },
  };
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('CodeModeProvisioningService — DB is SoT for default model', () => {
  const originalEnv = { ...process.env };
  let mockPrisma: ReturnType<typeof makePrisma>;

  beforeEach(() => {
    (ModelConfigurationService.getDefaultChatModel as any).mockReset();
    mockPrisma = makePrisma();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it('DB default chat model wins over poisoned env vars (openagentic_model in upsert)', async () => {
    process.env.CODE_MODE_DEFAULT_MODEL = 'env-poisoned-codemode';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';
    process.env.FALLBACK_MODEL = 'env-poisoned-fallback';

    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chat');

    const svc = new CodeModeProvisioningService(mockPrisma as any, makeLogger() as any);

    // startProvisioning calls upsert with openagentic_model
    // We stop after upsert — no need to run all provisioning steps
    // Intercept after upsert by rejecting the next step call
    (mockPrisma.codeModeProvisioning.update as any)
      .mockRejectedValueOnce(new Error('stop-after-upsert'));

    await svc.startProvisioning('user-1').catch(() => { /* expected */ });

    expect(mockPrisma.codeModeProvisioning.upsert).toHaveBeenCalled();
    const upsertCall = (mockPrisma.codeModeProvisioning.upsert as any).mock.calls[0][0];
    expect(upsertCall.create.openagentic_model).toBe('db-chat');
    expect(upsertCall.create.openagentic_model).not.toBe('env-poisoned-codemode');
    expect(upsertCall.create.openagentic_model).not.toBe('env-poisoned-default');
    expect(upsertCall.create.openagentic_model).not.toBe('env-poisoned-fallback');
    expect(ModelConfigurationService.getDefaultChatModel).toHaveBeenCalled();
  });

  it('no env vars set — DB model still flows through cleanly', async () => {
    delete process.env.CODE_MODE_DEFAULT_MODEL;
    delete process.env.DEFAULT_MODEL;
    delete process.env.FALLBACK_MODEL;

    (ModelConfigurationService.getDefaultChatModel as any).mockResolvedValue('db-chat');

    const svc = new CodeModeProvisioningService(mockPrisma as any, makeLogger() as any);

    (mockPrisma.codeModeProvisioning.update as any)
      .mockRejectedValueOnce(new Error('stop-after-upsert'));

    await svc.startProvisioning('user-1').catch(() => { /* expected */ });

    const upsertCall = (mockPrisma.codeModeProvisioning.upsert as any).mock.calls[0][0];
    expect(upsertCall.create.openagentic_model).toBe('db-chat');
  });

  it('DB fails → undefined (nullable String? field, acceptable)', async () => {
    process.env.CODE_MODE_DEFAULT_MODEL = 'env-poisoned-codemode';
    process.env.DEFAULT_MODEL = 'env-poisoned-default';
    process.env.FALLBACK_MODEL = 'env-poisoned-fallback';

    (ModelConfigurationService.getDefaultChatModel as any).mockRejectedValue(new Error('DB down'));

    const svc = new CodeModeProvisioningService(mockPrisma as any, makeLogger() as any);

    (mockPrisma.codeModeProvisioning.update as any)
      .mockRejectedValueOnce(new Error('stop-after-upsert'));

    await svc.startProvisioning('user-1').catch(() => { /* expected */ });

    const upsertCall = (mockPrisma.codeModeProvisioning.upsert as any).mock.calls[0][0];
    // When DB fails, resolveDefaultModel() returns undefined → openagentic_model is undefined
    expect(upsertCall.create.openagentic_model).toBeUndefined();
    expect(upsertCall.create.openagentic_model).not.toBe('env-poisoned-codemode');
    expect(upsertCall.create.openagentic_model).not.toBe('env-poisoned-default');
    expect(upsertCall.create.openagentic_model).not.toBe('env-poisoned-fallback');
  });
});
