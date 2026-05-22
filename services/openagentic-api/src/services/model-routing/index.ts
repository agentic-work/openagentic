/**
 * Public surface for the model-routing layer.
 *
 * Usage from server bootstrap (one-time):
 *
 *   import { initializeModelRouter } from './services/model-routing/index.js';
 *   initializeModelRouter({ prisma, logger });
 *
 * Usage from a route handler / pipeline stage:
 *
 *   import { getModelRouter } from './services/model-routing/index.js';
 *   const resolved = await getModelRouter().resolve({ userId, mode, requestedModel });
 *   const response  = await dispatchLLM({ router: getModelRouter(), logger, invoke }, resolved, input, request);
 *
 * Only exports here are called from outside the routing package.
 */

import type { Logger } from 'pino';
import { ModelRegistry, type PrismaLike } from './ModelRegistry.js';
import { ModelRouter } from './ModelRouter.js';

export { ModelRouter } from './ModelRouter.js';
export { ModelRegistry } from './ModelRegistry.js';
export { dispatchLLM, isRetryable } from './dispatch.js';
export type {
  Mode,
  ProviderType,
  ModelCapabilities,
  ModelLimits,
  ModelEntry,
  ModelSummary,
  RequiredCapabilities,
  ResolveInput,
  ResolveOutput,
  TenantDefaults,
  RouterLogEntry,
} from './types.js';
export {
  RouterError,
  UnknownModelError,
  CapabilityMismatchError,
  UnhealthyProviderError,
  DefaultNotConfiguredError,
} from './types.js';

let _singleton: ModelRouter | null = null;

export interface InitOptions {
  prisma: PrismaLike;
  logger: Logger;
}

/**
 * One-time init. Call from server.ts after Prisma + logger are ready. Safe to
 * call repeatedly — second call is a no-op so hot-reload doesn't double-init.
 */
export function initializeModelRouter({ prisma, logger }: InitOptions): ModelRouter {
  if (_singleton) return _singleton;
  const registry = new ModelRegistry(prisma, logger);
  _singleton = new ModelRouter({ registry, logger });
  logger.info('[model-routing] singleton initialized');
  return _singleton;
}

export function getModelRouter(): ModelRouter {
  if (!_singleton) {
    throw new Error('ModelRouter not initialized — call initializeModelRouter() at server bootstrap');
  }
  return _singleton;
}

/**
 * For tests only — replace the singleton with a harness instance.
 * Never call from production code paths.
 */
export function __setModelRouterForTests(router: ModelRouter | null): void {
  _singleton = router;
}

/**
 * For tests / admin endpoints — force a registry reload when the DB is known
 * to have changed outside the usual CRUD paths.
 */
export async function invalidateModelRouter(): Promise<void> {
  if (_singleton) await _singleton.invalidate();
}
