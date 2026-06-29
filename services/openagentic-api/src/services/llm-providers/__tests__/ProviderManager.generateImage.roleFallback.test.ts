/**
 * ProviderManager.generateImage — registry role-assignment fallback
 * (2026-06-24, generate_image-no-image regression).
 *
 * LIVE FAILURE (openagentic, gemini-2.5-flash + imagen via Vertex ADC): the
 * chat `generate_image` tool resolves request.model from
 * default_models.imageGen. A fresh install never seeds a `default_models`
 * system_configuration row, so imageGen is null → request.model arrives
 * UNDEFINED. The registry-SoT short-circuit (gated on `if (request.model)`)
 * is skipped, and the legacy provider_config.models[] scan finds nothing
 * (image models live in admin.model_role_assignments, not provider config).
 * Result: generateImage threw "No providers with image generation capability
 * are configured" even though imagen-4.0-fast-generate-001 IS registered to
 * the `image-generation` role and mapped to google-vertex.
 *
 * GREEN: a no-model caller now resolves the `image-generation` role from
 * model_role_assignments, routes to its mapped provider, and injects that
 * model id as request.model.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';

const SILENT_LOGGER: any = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => SILENT_LOGGER,
};

// Mock the prisma util so the role-assignment lookup resolves without a DB.
const findManyMock = vi.fn();
vi.mock('../../../utils/prisma.js', () => ({
  prisma: {
    modelRoleAssignment: { findMany: (...a: any[]) => findManyMock(...a) },
    tokenUsage: { create: vi.fn().mockResolvedValue({}) },
  },
}));

describe('ProviderManager.generateImage — registry role-assignment fallback (no-model caller)', () => {
  beforeEach(() => {
    findManyMock.mockReset();
  });

  test('resolves the image-generation role model + provider when request.model is undefined', async () => {
    const { ProviderManager } = await import('../ProviderManager.js');

    // image-generation role assigned to imagen-4.0, mapped to google-vertex.
    findManyMock.mockResolvedValue([{ model: 'imagen-4.0-fast-generate-001' }]);

    const vertexStub: any = {
      generateImage: vi.fn().mockResolvedValue({
        imageBase64: 'aW1hZ2UtYnl0ZXM=',
        model: 'imagen-4.0-fast-generate-001',
        provider: 'google-vertex',
        format: 'png',
        generationTimeMs: 900,
      }),
    };

    const pm: any = Object.create(ProviderManager.prototype);
    pm.initialized = true;
    pm.providers = new Map([['google-vertex', vertexStub]]);
    pm.modelToProviderMap = new Map([['imagen-4.0-fast-generate-001', 'google-vertex']]);
    // Legacy config has NO image models — this is the live regression shape.
    pm.config = { providers: [{ name: 'google-vertex', config: { models: [] } }], imageGenTimeout: 60_000 };
    pm.logger = SILENT_LOGGER;
    pm.ensureFreshProviders = async () => {};
    pm.enforceCostCap = async () => {};
    pm.incrementDailySpend = () => {};
    // Capture the request that reaches executeImageGen to assert model injection.
    let seenReq: any = null;
    pm.executeImageGen = async (provider: any, _name: string, req: any) => {
      seenReq = req;
      return provider.generateImage(req);
    };

    // NO model on the request — the failing live shape.
    const resp = await pm.generateImage({ prompt: 'a red circle on a white background' });

    expect(vertexStub.generateImage).toHaveBeenCalledOnce();
    expect(resp.imageBase64).toBe('aW1hZ2UtYnl0ZXM=');
    // The resolved model id was injected so cost-cap + tracking key by it.
    expect(seenReq.model).toBe('imagen-4.0-fast-generate-001');
    // The role lookup queried the kebab-case role the DB actually stores.
    const whereArg = findManyMock.mock.calls[0]?.[0]?.where;
    expect(whereArg.role.in).toContain('image-generation');
  });

  test('still throws clean error when no role assignment AND no legacy image model exist', async () => {
    const { ProviderManager } = await import('../ProviderManager.js');
    findManyMock.mockResolvedValue([]); // no image-generation role assigned

    const pm: any = Object.create(ProviderManager.prototype);
    pm.initialized = true;
    pm.providers = new Map([['google-vertex', { generateImage: vi.fn() }]]);
    pm.modelToProviderMap = new Map();
    pm.config = { providers: [{ name: 'google-vertex', config: { models: [] } }], imageGenTimeout: 60_000 };
    pm.logger = SILENT_LOGGER;
    pm.ensureFreshProviders = async () => {};
    pm.enforceCostCap = async () => {};

    await expect(pm.generateImage({ prompt: 'x' })).rejects.toThrow(
      /No providers with image generation capability/,
    );
  });
});
