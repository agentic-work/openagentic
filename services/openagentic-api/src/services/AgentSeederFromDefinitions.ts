/**
 * AgentSeederFromDefinitions — Milvus seeder for the agent catalog.
 *
 * On boot the api pulls the canonical agent catalog from openagentic-proxy
 * (`GET /api/agents/definitions`, which already merges built-ins +
 * DB-backed agents) and upserts each entry into the `agents` Milvus
 * collection through `AgentSemanticSearchService.upsertAgent`.
 *
 * Idempotent: re-running upserts the same rows (the search service
 * de-dupes by primary id).
 *
 * Failure-tolerant: a network error or 5xx returns
 * `{seeded:0, errors:[...]}` instead of throwing — the seeder is a
 * best-effort step and must NEVER block api startup.
 *
 * Wire-up: this seeder is intentionally NOT auto-registered to a
 * startup step yet. It needs (a) the openagentic-proxy service to be ready
 * (post-bootstrap), and (b) AgentSemanticSearchService.init() to have
 * run. The intended wire-up site is `src/startup/06-rag.ts`, after
 * the tool semantic cache initializes — see TODO note in this file.
 *
 * Plan: docs/superpowers/specs/2026-05-02-tool-selection-at-scale-research.md
 */

import type { Logger } from 'pino';
import type { AgentDefinition } from './AgentSemanticSearchService.js';

export interface AgentSeederSearchServiceLike {
  upsertAgent(def: AgentDefinition): Promise<void>;
}

export interface AgentSeederOptions {
  /** openagentic-proxy base URL (default: env OPENAGENTIC_PROXY_URL or 'http://openagentic-proxy:3300'). */
  openagenticProxyUrl?: string;
  /**
   * Internal-key bearer token openagentic-proxy expects on its auth path.
   * Defaults to env OPENAGENTIC_PROXY_INTERNAL_KEY.
   */
  internalKey?: string;
  /** AgentSemanticSearchService (or a compatible mock with upsertAgent). */
  searchService: AgentSeederSearchServiceLike;
  /** Test override for fetch. */
  fetchImpl?: typeof fetch;
  /** Logger. Defaults to a no-op. */
  logger?: Logger;
  /** Per-request timeout in ms. Default 5000. */
  timeoutMs?: number;
}

export interface SeedResult {
  /** Number of definitions upserted into Milvus. */
  seeded: number;
  /** Number of definitions skipped (e.g. empty description). */
  skipped: number;
  /** Per-row error messages — non-fatal, seeding continues on each error. */
  errors: string[];
}

const DEFAULT_OPENAGENTIC_PROXY_URL = 'http://openagentic-proxy:3300';
const DEFAULT_TIMEOUT_MS = 5000;

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

interface RawAgentDef {
  id: string;
  name?: string;
  description?: string;
  role?: string;
  tools?: string[];
  [k: string]: unknown;
}

export class AgentSeederFromDefinitions {
  private readonly openagenticProxyUrl: string;
  private readonly internalKey: string;
  private readonly searchService: AgentSeederSearchServiceLike;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: Logger | typeof noopLogger;
  private readonly timeoutMs: number;

  constructor(opts: AgentSeederOptions) {
    this.openagenticProxyUrl =
      opts.openagenticProxyUrl
      ?? process.env.OPENAGENTIC_PROXY_URL
      ?? DEFAULT_OPENAGENTIC_PROXY_URL;
    this.internalKey =
      opts.internalKey
      ?? process.env.OPENAGENTIC_PROXY_INTERNAL_KEY
      ?? '';
    this.searchService = opts.searchService;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.logger = (opts.logger ?? noopLogger) as any;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Pull every agent definition from openagentic-proxy and upsert into Milvus.
   * Returns the per-row outcome. Never throws.
   */
  async seedFromOpenAgenticProxy(): Promise<SeedResult> {
    const result: SeedResult = { seeded: 0, skipped: 0, errors: [] };

    let definitions: RawAgentDef[];
    try {
      definitions = await this.fetchDefinitions();
    } catch (err: any) {
      const msg = `failed to fetch agent definitions: ${err?.message ?? err}`;
      (this.logger as any).warn?.({ err: err?.message }, '[agent-seeder] ' + msg);
      result.errors.push(msg);
      return result;
    }

    for (const def of definitions) {
      try {
        if (!def.description || def.description.trim().length === 0) {
          result.skipped += 1;
          continue;
        }
        await this.searchService.upsertAgent({
          id: String(def.id),
          agent_id: String(def.id),
          name: String(def.name ?? def.id),
          description: String(def.description ?? ''),
          role: String(def.role ?? 'general'),
          tools: Array.isArray(def.tools) ? def.tools : [],
        });
        result.seeded += 1;
      } catch (err: any) {
        const msg = `upsert failed for ${def.id}: ${err?.message ?? err}`;
        (this.logger as any).warn?.({ err: err?.message, id: def.id }, '[agent-seeder] ' + msg);
        result.errors.push(msg);
      }
    }

    (this.logger as any).info?.(
      { seeded: result.seeded, skipped: result.skipped, errors: result.errors.length },
      '[agent-seeder] seedFromOpenAgenticProxy complete',
    );
    return result;
  }

  private async fetchDefinitions(): Promise<RawAgentDef[]> {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        'x-request-from': 'agent-seeder',
      };
      if (this.internalKey) {
        headers['Authorization'] = `Bearer ${this.internalKey}`;
        headers['x-openagentic-proxy'] = 'true';
      }
      const res = await this.fetchImpl(
        `${this.openagenticProxyUrl}/api/agents/definitions`,
        { method: 'GET', headers, signal: ac.signal },
      );
      if (!res.ok) {
        throw new Error(`openagentic-proxy returned ${res.status}`);
      }
      const data: any = await res.json();
      const list = Array.isArray(data?.agents) ? data.agents : [];
      return list as RawAgentDef[];
    } finally {
      clearTimeout(timer);
    }
  }
}

export default AgentSeederFromDefinitions;
