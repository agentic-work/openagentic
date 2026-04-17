import { prisma } from '../../utils/prisma.js';
import { loggers } from '../../utils/logger.js';
import { getRedisClient } from '../../utils/redis-client.js';
import type { PromptModule, ModuleCategory } from './types.js';

const log = loggers.prompt;

const REDIS_KEY = 'prompt:modules:all';
const REDIS_TTL = parseInt(process.env.PROMPT_MODULE_CACHE_TTL || '300'); // 5 minutes default
const MEM_CACHE_TTL = parseInt(process.env.PROMPT_MODULE_MEM_TTL || '60000'); // 1 minute in-memory

function dbRowToModule(row: any): PromptModule {
  return {
    id: row.id,
    name: row.name,
    category: row.category as any,
    content: row.content,
    description: row.description,
    priority: row.priority,
    tokenCost: row.token_cost,
    enabled: row.enabled,
    injection: row.injection as any,
    // `row.variants` on legacy DB rows is read-ignored — post-neutralization
    // every adapter renders from `content` alone. See
    // docs/architecture/composable-prompt-neutralization.md.
    version: row.version,
  };
}

export class PromptModuleRegistry {
  private static instance: PromptModuleRegistry;

  private cache: PromptModule[] | null = null;
  private cacheTimestamp: number = 0;
  private cacheTTL: number;

  private constructor(cacheTTL: number = MEM_CACHE_TTL) {
    this.cacheTTL = cacheTTL;
  }

  static getInstance(): PromptModuleRegistry {
    if (!PromptModuleRegistry.instance) {
      PromptModuleRegistry.instance = new PromptModuleRegistry();
    }
    return PromptModuleRegistry.instance;
  }

  // ── Exposed for testing ───────────────────────────────────────────────────
  static createForTest(cacheTTL: number = MEM_CACHE_TTL): PromptModuleRegistry {
    return new PromptModuleRegistry(cacheTTL);
  }

  // ── Cache helpers ─────────────────────────────────────────────────────────

  private isMemCacheValid(): boolean {
    return this.cache !== null && Date.now() - this.cacheTimestamp < this.cacheTTL;
  }

  invalidateCache(): void {
    this.cache = null;
    this.cacheTimestamp = 0;
    // Fire-and-forget Redis invalidation
    getRedisClient().del(REDIS_KEY).catch(() => {});
  }

  // ── Core data access ──────────────────────────────────────────────────────

  async getAll(): Promise<PromptModule[]> {
    // 1. In-memory cache
    if (this.isMemCacheValid()) {
      return this.cache!;
    }

    // 2. Redis cache
    const redis = getRedisClient();
    const cached = await redis.get<PromptModule[]>(REDIS_KEY);
    if (cached) {
      this.cache = cached;
      this.cacheTimestamp = Date.now();
      return cached;
    }

    // 3. Prisma (DB)
    const rows = await prisma.promptModule.findMany({
      orderBy: { priority: 'desc' },
    });

    const modules = rows.map(dbRowToModule);
    this.cache = modules;
    this.cacheTimestamp = Date.now();
    redis.set(REDIS_KEY, modules, REDIS_TTL).catch(() => {});

    log.debug({ count: modules.length }, '[PromptModuleRegistry] Loaded modules from DB');
    return modules;
  }

  async getEnabled(): Promise<PromptModule[]> {
    const all = await this.getAll();
    return all.filter((m) => m.enabled);
  }

  async getByCategory(cat: ModuleCategory): Promise<PromptModule[]> {
    const all = await this.getAll();
    return all.filter((m) => m.category === cat);
  }

  async getById(id: string): Promise<PromptModule | null> {
    const all = await this.getAll();
    return all.find((m) => m.id === id) ?? null;
  }

  async getByName(name: string): Promise<PromptModule | null> {
    const all = await this.getAll();
    return all.find((m) => m.name === name) ?? null;
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  async update(
    id: string,
    data: Partial<PromptModule>,
    editedBy: string,
  ): Promise<PromptModule> {
    // Load current to create history entry
    const current = await prisma.promptModule.findUniqueOrThrow({ where: { id } });

    // Recalculate token cost if content changed
    const newContent = data.content ?? current.content;
    const newTokenCost = Math.ceil(newContent.length / 3.5);

    const updated = await prisma.promptModule.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.category !== undefined && { category: data.category }),
        ...(data.content !== undefined && { content: data.content }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.enabled !== undefined && { enabled: data.enabled }),
        ...(data.injection !== undefined && { injection: data.injection as any }),
        token_cost: newTokenCost,
        version: { increment: 1 },
      },
    });

    // Write history entry
    await prisma.promptModuleHistory.create({
      data: {
        module_id: id,
        content: current.content,
        version: current.version,
        edited_by: editedBy,
      },
    });

    this.invalidateCache();
    log.info({ id, editedBy }, '[PromptModuleRegistry] Module updated');
    return dbRowToModule(updated);
  }

  async create(data: Omit<PromptModule, 'id' | 'version'>): Promise<PromptModule> {
    const tokenCost = Math.ceil(data.content.length / 3.5);
    const created = await prisma.promptModule.create({
      data: {
        name: data.name,
        category: data.category,
        content: data.content,
        description: data.description,
        priority: data.priority,
        token_cost: tokenCost,
        enabled: data.enabled,
        injection: data.injection as any,
        version: 1,
      },
    });

    this.invalidateCache();
    log.info({ name: data.name }, '[PromptModuleRegistry] Module created');
    return dbRowToModule(created);
  }
}
