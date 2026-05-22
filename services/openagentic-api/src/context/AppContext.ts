/**
 * AppContext — Phase 1 of server.ts decomposition.
 *
 * Consolidates the 12 former module-scope `let` declarations from server.ts
 * into a single typed object that is decorated onto the Fastify instance.
 * Route handlers access shared services via `request.server.app.X`.
 *
 * Lifecycle:
 *  1. `const ctx = new AppContext({ prisma, logger })` early in start().
 *  2. Each service is assigned to ctx.X as it is initialized.
 *  3. `decorateApp(server, ctx)` registers ctx on the Fastify instance.
 *
 * The deprecated global bridge `(global as any).appContext = ctx` was removed
 * in Phase 4. Non-plugin consumers now use `getAppContext()` from this module.
 */

import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { Logger } from 'pino';
import type { ProviderManager } from '../services/llm-providers/ProviderManager.js';
import type { SmartModelRouter } from '../services/SmartModelRouter.js';
import type ToolSemanticCacheService from '../services/ToolSemanticCacheService.js';
import type { AgentSemanticSearchService } from '../services/AgentSemanticSearchService.js';
import type { MilvusClient } from '@zilliz/milvus2-sdk-node';
import type { MilvusVectorService } from '../services/MilvusVectorService.js';
import type { DocumentIndexingService } from '../services/DocumentIndexingService.js';
import type { ChatStorageService } from '../services/ChatStorageService.js';
import type { JobCompletionWatcher } from '../services/JobCompletionWatcher.js';
import type { RbacSystemPromptService } from '../services/prompt/RbacSystemPromptService.js';
import type { ServicePromptService } from '../services/prompt/ServicePromptService.js';
import type { RAGService } from '../services/RAGService.js';
import type { ModelHealthCheckService } from '../services/ModelHealthCheck.js';
import type { RepositoryContainer } from '../repositories/RepositoryContainer.js';

// ---------------------------------------------------------------------------
// Deps required at construction time
// ---------------------------------------------------------------------------

export interface AppContextDeps {
  prisma: PrismaClient;
  logger: Logger;
}

// ---------------------------------------------------------------------------
// AppContext class
// ---------------------------------------------------------------------------

export class AppContext {
  // Services that are set during start() as they are initialized.
  // All optional — they start undefined and are assigned as the startup
  // sequence progresses.

  public providerManager?: ProviderManager | null;
  public smartModelRouter?: SmartModelRouter | null;
  public modelHealthCheck?: ModelHealthCheckService;

  public milvusClient?: MilvusClient;
  public milvusVectorService?: MilvusVectorService;
  public documentIndexingService?: DocumentIndexingService | null;
  public ragService?: RAGService;

  public toolSemanticCache?: ToolSemanticCacheService;
  public toolSemanticCacheInitialized: boolean = false;

  // 2026-05-02 — agent catalog semantic search (Milvus `agents` collection;
  // dropped legacy `mcp_*` prefix in Phase E.9 on 2026-05-10)
  // Used by the synthetic `agent_search` meta-tool and the openagentic-proxy
  // forwarding route. Initialized in startup/06-rag.ts alongside the
  // tool semantic cache. Optional — degrades to [] when absent.
  public agentSemanticSearch?: AgentSemanticSearchService;
  public agentSemanticSearchInitialized: boolean = false;

  public chatStorage?: ChatStorageService;
  public jobCompletionWatcher?: JobCompletionWatcher;
  // promptService (CachedPromptService) RIPPED 2026-05-11 — see startup/09-prompt-cache.ts.
  // The RBAC system prompt service replaces it at `rbacSystemPromptService` below.
  /**
   * P-Live-2/3 — DB-backed RBAC system prompt service. Reads role-keyed
   * prompts from `rbac_system_prompts` with in-memory cache + redis-pubsub
   * cross-pod invalidation on the `prompt:invalidate` channel. Initialized
   * by `startup/09-prompt-cache.ts`.
   */
  public rbacSystemPromptService?: RbacSystemPromptService;
  /**
   * Sprint W (2026-05-19) — DB-backed service prompt service. Reads named
   * prompt keys from `service_prompts` (admin schema). Same process-local
   * cache + redis-pubsub cross-pod invalidation pattern as rbacSystemPromptService.
   * Initialized by `startup/09-prompt-cache.ts`.
   */
  public servicePromptService?: ServicePromptService;
  public repositoryContainer?: RepositoryContainer | null;

  constructor(public deps: AppContextDeps) {}
}

// ---------------------------------------------------------------------------
// Fastify module augmentation — adds `app: AppContext` to FastifyInstance
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyInstance {
    app: AppContext;
  }
}

// ---------------------------------------------------------------------------
// decorateApp helper — registers ctx on the Fastify instance
// ---------------------------------------------------------------------------

export function decorateApp(server: FastifyInstance, ctx: AppContext): void {
  server.decorate('app', ctx);
}

// ---------------------------------------------------------------------------
// AppContext singleton accessor (Phase 4 — replaces (global as any).appContext)
// ---------------------------------------------------------------------------

let _appContextInstance: AppContext | null = null;

export function setAppContext(ctx: AppContext): void {
  _appContextInstance = ctx;
}

export function getAppContext(): AppContext | null {
  return _appContextInstance;
}

// ---------------------------------------------------------------------------
// freezeAppContext — enforce set-once contract post-runStartup
// ---------------------------------------------------------------------------

/**
 * Freeze ctx (and ctx.deps) so that any post-startup mutation throws
 * TypeError in strict mode. Call this in server.ts after all bootstrap
 * assignments are complete (i.e. after runStartup + chatStorage init).
 *
 * If a field genuinely needs to be mutable at runtime (e.g. a rotating
 * cache handle), extract it out of AppContext into a separate singleton.
 */
export function freezeAppContext(ctx: AppContext): void {
  Object.freeze(ctx.deps);
  Object.freeze(ctx);
}
