/**
 * Admin Tiered Function-Calling Config Routes — GET/PUT /api/admin/tiered-fc
 *
 * Read/persist the tiered function-calling (FCA) configuration the admin
 * SettingsPane edits. The backing store is the SAME admin.system_configuration
 * keys that TieredFunctionCallingService.loadConfig() reads, so a PUT here is
 * picked up live by the running service (its config cache TTL expires, then it
 * re-reads these rows). No new table — we reuse the SoT the service already owns.
 *
 * Mirrors admin-audit-log.ts: per-route `onRequest: adminMiddleware`, the shared
 * `prisma` singleton, registered with prefix /api/admin so the final URLs are
 * /api/admin/tiered-fc (GET + PUT).
 *
 * UI contract (pages-v3/system/SettingsPane.tsx):
 *   - GET  → returns the TieredFCConfig object directly (useAdminQuery<TieredFCConfig>)
 *   - PUT  → body is Partial<TieredFCConfig> (only the changed keys); the
 *            handler upserts just those keys and responds { config: TieredFCConfig }.
 *
 * TieredFCConfig (UI):
 *   enabled?, toolStrippingEnabled?, decisionCacheEnabled?, decisionCacheTTL?,
 *   cheapModel?, balancedModel?, premiumModel?
 *
 * Model ids (cheap/balanced/premium) come from operator input / the config
 * store — they are NOT hardcoded here (see no-hardcoded-models rule).
 */
import type { FastifyInstance } from 'fastify';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { prisma } from '../utils/prisma.js';

// admin.system_configuration keys — kept in lockstep with the CONFIG_KEYS in
// services/TieredFunctionCallingService.ts so the running service reads what we
// write. `tiered_function_calling_enabled` is the master toggle the UI exposes
// as `enabled` (the service treats absence as "on" by default per its env shape).
const KEYS = {
  enabled: 'tiered_function_calling_enabled',
  toolStrippingEnabled: 'tool_stripping_enabled',
  decisionCacheEnabled: 'function_decision_cache_enabled',
  decisionCacheTTL: 'function_decision_cache_ttl_seconds',
  cheapModel: 'function_calling_model_cheap',
  balancedModel: 'function_calling_model_balanced',
  premiumModel: 'function_calling_model_premium',
} as const;

type UiKey = keyof typeof KEYS;

interface TieredFCConfig {
  enabled?: boolean;
  toolStrippingEnabled?: boolean;
  decisionCacheEnabled?: boolean;
  decisionCacheTTL?: number;
  cheapModel?: string;
  balancedModel?: string;
  premiumModel?: string;
}

const BOOL_KEYS: UiKey[] = ['enabled', 'toolStrippingEnabled', 'decisionCacheEnabled'];
const NUM_KEYS: UiKey[] = ['decisionCacheTTL'];
const STR_KEYS: UiKey[] = ['cheapModel', 'balancedModel', 'premiumModel'];

/** Read the current persisted config, projecting only keys that exist. */
async function loadConfig(): Promise<TieredFCConfig> {
  const rows = await prisma.systemConfiguration.findMany({
    where: { key: { in: Object.values(KEYS) }, is_active: true },
    select: { key: true, value: true },
  });
  const byStoreKey = new Map(rows.map((r) => [r.key, r.value]));
  const out: TieredFCConfig = {};

  for (const k of BOOL_KEYS) {
    if (byStoreKey.has(KEYS[k])) {
      const v = byStoreKey.get(KEYS[k]);
      (out as any)[k] = v === true || v === 'true';
    }
  }
  for (const k of NUM_KEYS) {
    if (byStoreKey.has(KEYS[k])) {
      const v = byStoreKey.get(KEYS[k]);
      const n = typeof v === 'number' ? v : Number.parseInt(String(v), 10);
      if (Number.isFinite(n)) (out as any)[k] = n;
    }
  }
  for (const k of STR_KEYS) {
    if (byStoreKey.has(KEYS[k])) {
      const v = byStoreKey.get(KEYS[k]);
      if (typeof v === 'string' && v.trim() !== '') (out as any)[k] = v;
    }
  }
  return out;
}

export default async function adminTieredFcRoutes(fastify: FastifyInstance) {
  // GET /api/admin/tiered-fc → TieredFCConfig (object directly).
  fastify.get('/tiered-fc', { onRequest: adminMiddleware }, async (_request, reply) => {
    try {
      const config = await loadConfig();
      return reply.send(config);
    } catch (error) {
      fastify.log.error({ error }, '[admin] failed to read tiered-fc config');
      return reply.code(500).send({
        error: 'Failed to read tiered function-calling config',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // PUT /api/admin/tiered-fc — body is Partial<TieredFCConfig> (changed keys only).
  // Upsert each present, valid key into system_configuration. Respond { config }.
  fastify.put<{ Body: Partial<TieredFCConfig> }>(
    '/tiered-fc',
    { onRequest: adminMiddleware },
    async (request, reply) => {
      try {
        const body = request.body ?? {};
        if (typeof body !== 'object' || Array.isArray(body)) {
          return reply.code(400).send({ error: 'BAD_REQUEST', message: 'Body must be a TieredFCConfig object' });
        }

        const userId = (request as any).user?.id ?? null;
        const writes: Array<{ key: string; value: unknown; description: string }> = [];

        for (const k of BOOL_KEYS) {
          if (k in body) {
            const v = (body as any)[k];
            if (typeof v !== 'boolean') {
              return reply.code(400).send({ error: 'INVALID_VALUE', message: `${k} must be a boolean` });
            }
            writes.push({ key: KEYS[k], value: v, description: `Tiered FC: ${k}` });
          }
        }
        for (const k of NUM_KEYS) {
          if (k in body) {
            const v = (body as any)[k];
            if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
              return reply.code(400).send({ error: 'INVALID_VALUE', message: `${k} must be a non-negative number` });
            }
            writes.push({ key: KEYS[k], value: v, description: `Tiered FC: ${k}` });
          }
        }
        for (const k of STR_KEYS) {
          if (k in body) {
            const v = (body as any)[k];
            if (typeof v !== 'string') {
              return reply.code(400).send({ error: 'INVALID_VALUE', message: `${k} must be a string (model id)` });
            }
            if (v.length > 200) {
              return reply.code(400).send({ error: 'INVALID_VALUE', message: `${k} model id too long` });
            }
            writes.push({ key: KEYS[k], value: v, description: `Tiered FC: ${k}` });
          }
        }

        for (const w of writes) {
          await prisma.systemConfiguration.upsert({
            where: { key: w.key },
            create: { key: w.key, value: w.value as any, description: w.description, is_active: true, updated_by: userId },
            update: { value: w.value as any, is_active: true, updated_by: userId },
          });
        }

        const config = await loadConfig();
        return reply.send({ config });
      } catch (error) {
        fastify.log.error({ error }, '[admin] failed to update tiered-fc config');
        return reply.code(500).send({
          error: 'Failed to update tiered function-calling config',
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
  );
}
