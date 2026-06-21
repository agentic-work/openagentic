/**
 * ModelRegistry — the SOLE source of "what models exist and which provider runs them".
 *
 * Loaded from admin.llm_providers.provider_config.models[] (canonical). No other
 * DB field, env var, or heuristic contributes. If a model isn't in that array for
 * an enabled-and-healthy provider, the registry doesn't know about it and
 * ModelRouter.resolve() will 400.
 *
 * Invalidation: the admin CRUD routes already publish `provider:reload` on Redis
 * (see ProviderManager.invalidateAllModelCaches). The registry subscribes to that
 * channel and reloads. In-process TTL of 30s covers the case where pub/sub isn't
 * available (single-replica dev).
 */

import type { Logger } from 'pino';
import type {
  Mode, ModelEntry, ModelSummary, ProviderType, TenantDefaults,
} from './types.js';

const CACHE_TTL_MS = 30_000;

interface RawProviderRow {
  id: string;
  name: string;
  provider_type: string;
  enabled: boolean;
  priority: number;
  status: string;
  provider_config: any;
  capabilities: any;
  deleted_at: Date | null;
}

interface RawModelJson {
  id?: string;
  name?: string;
  aliases?: string[];
  deploymentId?: string;
  capabilities?: any;
  config?: any;              // legacy nested shape from admin-add UI
  maxInputTokens?: number;
  maxOutputTokens?: number;
  tier?: string;
  costTier?: string;
  costUsdPer1kIn?: number;
  costUsdPer1kOut?: number;
  fallbackIds?: string[];
  enabledForChat?: boolean;
  enabledForCodemode?: boolean;
}

export interface PrismaLike {
  lLMProvider: {
    findMany(args: any): Promise<any[]>;
  };
  systemConfiguration: {
    findUnique(args: any): Promise<any>;
  };
}

/**
 * Registry owns the in-memory indexes. Single instance per API process.
 * Call initialize() once at boot, then subscribeReload() to hook pub/sub.
 */
export class ModelRegistry {
  private byCanonical = new Map<string, ModelEntry>();
  private byAlias = new Map<string, string>();       // alias → canonical
  private byMode: Record<Mode, ModelEntry[]> = {
    chat: [], code: [], embedding: [], vision: [], imageGen: [],
  };
  private defaults: TenantDefaults = {
    chat: null, code: null, embedding: null, vision: null, imageGen: null,
  };
  private loadedAt = 0;
  private loadingPromise: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaLike,
    private readonly logger: Logger,
  ) {}

  /**
   * Ensure the registry is loaded (or reload if TTL expired). Cheap on hot path
   * when cache is warm; each resolve() calls this first.
   */
  async ensureLoaded(): Promise<void> {
    if (Date.now() - this.loadedAt < CACHE_TTL_MS) return;
    if (this.loadingPromise !== null) { await this.loadingPromise; return; }
    this.loadingPromise = this.load().finally(() => { this.loadingPromise = null; });
    await this.loadingPromise;
  }

  /** Force a reload — called on Redis pub/sub or admin CRUD. */
  async invalidate(): Promise<void> {
    this.loadedAt = 0;
    await this.ensureLoaded();
  }

  private async load(): Promise<void> {
    const t0 = Date.now();
    const [providers, defaultsRow] = await Promise.all([
      this.prisma.lLMProvider.findMany({
        where: { enabled: true, deleted_at: null },
        orderBy: { priority: 'asc' },
      }),
      this.prisma.systemConfiguration.findUnique({
        where: { key: 'default_models' },
      }).catch(() => null),
    ]);

    this.byCanonical.clear();
    this.byAlias.clear();
    for (const m of Object.keys(this.byMode) as Mode[]) this.byMode[m] = [];

    // Pull every enabled Registry row in one query. The legacy
    // provider_config.models[] field is no longer read; admin.model_role_assignments
    // is the SoT. Group by provider name so we can preserve the
    // priority-tiebreaker semantics (provider priority asc → first wins).
    const registryRows = await (this.prisma as any).modelRoleAssignment.findMany({
      where: { enabled: true },
      select: { model: true, provider: true, capabilities: true, role: true, max_tokens: true, description: true },
    });
    const rowsByProvider = new Map<string, any[]>();
    for (const r of registryRows) {
      const arr = rowsByProvider.get(r.provider) ?? [];
      arr.push(r);
      rowsByProvider.set(r.provider, arr);
    }

    for (const row of providers as RawProviderRow[]) {
      const providerName = row.name;
      const providerType = row.provider_type as ProviderType;
      const providerStatus = (row.status as ModelEntry['providerStatus']) || 'active';
      const providerCaps = (row.capabilities as any) || {};
      const registryForProvider = rowsByProvider.get(providerName) ?? [];
      // Adapt Registry row shape to the buildEntry expectation. The
      // Registry's `model` is the canonical id; capabilities flow
      // through; max_tokens/description map to optional metadata.
      const models: RawModelJson[] = registryForProvider.map((r): RawModelJson => ({
        id: r.model,
        name: r.description || r.model,
        capabilities: (r.capabilities as any) || {},
        config: { maxOutputTokens: r.max_tokens ?? undefined },
        contextWindow: undefined,
      } as any));

      for (const raw of models) {
        const entry = this.buildEntry(raw, providerName, providerType, providerStatus, row.priority, providerCaps);
        if (!entry) continue;

        // Priority tiebreaker: first wins (providers sorted by priority ascending already).
        if (this.byCanonical.has(entry.id)) continue;

        this.byCanonical.set(entry.id, entry);
        for (const alias of entry.aliases) {
          const aliasKey = alias.toLowerCase();
          if (!this.byAlias.has(aliasKey)) this.byAlias.set(aliasKey, entry.id);
        }
        if (entry.enabledForChat)     this.byMode.chat.push(entry);
        if (entry.enabledForCodemode) this.byMode.code.push(entry);
        if (entry.capabilities.embeddings) this.byMode.embedding.push(entry);
        if (entry.capabilities.vision)     this.byMode.vision.push(entry);
        if (entry.capabilities.imageGen)   this.byMode.imageGen.push(entry);
      }
    }

    this.defaults = this.parseDefaults(defaultsRow?.value);
    this.loadedAt = Date.now();

    this.logger.info({
      providerCount: providers.length,
      modelCount: this.byCanonical.size,
      aliasCount: this.byAlias.size,
      defaults: this.defaults,
      loadMs: Date.now() - t0,
    }, '[ModelRegistry] loaded');
  }

  private buildEntry(
    raw: RawModelJson,
    providerName: string,
    providerType: ProviderType,
    providerStatus: ModelEntry['providerStatus'],
    providerPriority: number,
    providerCaps: any,
  ): ModelEntry | null {
    const id = raw.id || raw.name;
    if (!id || typeof id !== 'string') return null;

    // Merge capabilities: provider-level defaults → model-level override.
    const mCaps = raw.capabilities || {};
    const capabilities = {
      chat:       mCaps.chat       ?? providerCaps.chat       ?? true,
      tools:      mCaps.tools      ?? providerCaps.tools      ?? true,
      streaming:  mCaps.streaming  ?? providerCaps.streaming  ?? true,
      vision:     mCaps.vision     ?? providerCaps.vision     ?? false,
      thinking:   mCaps.thinking   ?? providerCaps.thinking   ?? false,
      embeddings: mCaps.embeddings ?? providerCaps.embeddings ?? false,
      imageGen:   mCaps.imageGen   ?? mCaps.imageGeneration   ?? providerCaps.imageGen ?? providerCaps.imageGeneration ?? false,
      extended:   Array.isArray(mCaps.extended) ? mCaps.extended : undefined,
    };

    // Accept both top-level and nested-in-config for legacy admin-add shape.
    const limits = {
      maxInputTokens:  raw.maxInputTokens  ?? raw.config?.maxInputTokens,
      maxOutputTokens: raw.maxOutputTokens ?? raw.config?.maxOutputTokens,
    };

    const enabledForChat =
      raw.enabledForChat ?? raw.config?.enabledForChat ?? capabilities.chat;
    const enabledForCodemode =
      raw.enabledForCodemode ?? raw.config?.enabledForCodemode ?? capabilities.chat;

    return {
      id,
      aliases: Array.isArray(raw.aliases) ? raw.aliases.filter((a): a is string => typeof a === 'string' && a.length > 0) : [],
      deploymentId: raw.deploymentId,
      capabilities,
      limits,
      tier: raw.tier || raw.costTier,
      costUsdPer1kIn: raw.costUsdPer1kIn,
      costUsdPer1kOut: raw.costUsdPer1kOut,
      fallbackIds: Array.isArray(raw.fallbackIds) ? raw.fallbackIds : [],
      enabledForChat,
      enabledForCodemode,
      providerName,
      providerType,
      providerStatus,
      providerPriority,
    };
  }

  private parseDefaults(value: any): TenantDefaults {
    // Tolerate missing row, string (legacy JSON-stringified), or object.
    const empty: TenantDefaults = {
      chat: null, code: null, embedding: null, vision: null, imageGen: null,
    };
    if (!value) return empty;
    let parsed = value;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { return empty; }
    }
    if (typeof parsed !== 'object' || parsed === null) return empty;
    return {
      chat:      typeof parsed.chat      === 'string' ? parsed.chat      : null,
      code:      typeof parsed.code      === 'string' ? parsed.code      : null,
      embedding: typeof parsed.embedding === 'string' ? parsed.embedding : null,
      vision:    typeof parsed.vision    === 'string' ? parsed.vision    : null,
      imageGen:  typeof parsed.imageGen  === 'string' ? parsed.imageGen  : null,
    };
  }

  // ── Public lookup API ──────────────────────────────────────────────────────

  /**
   * Find by canonical id OR explicit alias. Case-insensitive. Returns null if
   * not registered. No fuzzy matching — use suggestSimilar() for the UX tail.
   */
  find(idOrAlias: string): ModelEntry | null {
    if (!idOrAlias) return null;
    const key = idOrAlias.toLowerCase();
    // Canonical ids in the map are stored as-provided (usually lowercase-y already).
    const direct = this.byCanonical.get(idOrAlias) || this.byCanonical.get(key);
    if (direct) return direct;
    const canonical = this.byAlias.get(key);
    return canonical ? this.byCanonical.get(canonical) || null : null;
  }

  /** Summary list for the UI picker. Mode-scoped. Ordered by provider priority. */
  list(mode: Mode): ModelSummary[] {
    return this.byMode[mode].map((e) => ({
      id: e.id,
      aliases: e.aliases,
      providerName: e.providerName,
      providerType: e.providerType,
      tier: e.tier,
      capabilities: e.capabilities,
      limits: e.limits,
      costUsdPer1kIn: e.costUsdPer1kIn,
      costUsdPer1kOut: e.costUsdPer1kOut,
      available: e.providerStatus === 'active',
    }));
  }

  /** Tenant default for a mode. Null iff admin hasn't configured one. */
  defaultFor(mode: Mode): string | null {
    return this.defaults[mode];
  }

  /**
   * Suggest up to N registered ids closest to an unknown input. Simple Levenshtein
   * over canonical ids. No external dep — a 30-line implementation is enough.
   */
  suggestSimilar(input: string, limit = 3): string[] {
    if (!input) return [];
    const needle = input.toLowerCase();
    const all = [...this.byCanonical.keys()];
    const scored = all.map((id) => ({
      id,
      score: levenshtein(needle, id.toLowerCase()),
    }));
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, limit).map((s) => s.id);
  }

  /** Dev/admin introspection. Never used in the hot path. */
  snapshot(): { models: ModelEntry[]; defaults: TenantDefaults; loadedAt: number } {
    return {
      models: [...this.byCanonical.values()],
      defaults: { ...this.defaults },
      loadedAt: this.loadedAt,
    };
  }
}

/** Classic dynamic-programming Levenshtein. Small inputs (<200 chars) so O(mn) is fine. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,        // insertion
        prev[j] + 1,            // deletion
        prev[j - 1] + cost,     // substitution
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}
