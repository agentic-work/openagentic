/**
 * GeminiCacheManager — Vertex AI `cachedContents` resource lifecycle.
 *
 * Companion to the SDK adapter's `cached_content` wire field. The adapter
 * emits a resource reference on the outbound `generateContent` body when
 * the canonical request supplies one; this manager is what CREATES the
 * resource so the caller has a reference to supply.
 *
 * Wire surface (REST, region-prefixed Vertex AI endpoint):
 *   POST   /v1/projects/{P}/locations/{L}/cachedContents          → create
 *   GET    /v1/projects/{P}/locations/{L}/cachedContents/{ID}     → fetch
 *   PATCH  /v1/projects/{P}/locations/{L}/cachedContents/{ID}     → refresh TTL
 *                                                  ?updateMask=ttl
 *   DELETE /v1/projects/{P}/locations/{L}/cachedContents/{ID}     → cleanup
 *
 * Minimum cacheable token counts (server-enforced):
 *   - Gemini 1.5 Flash / Pro: 32,768 tokens
 *   - Gemini 2.5 Flash / Pro:  4,096 tokens
 *
 * Resource name shape: `projects/{P}/locations/{L}/cachedContents/{ID}` —
 * this is the same string the SDK adapter emits on the `cachedContent`
 * wire field. The manager is stateless w.r.t. cache identity: callers
 * persist the resource name themselves (Redis, in-memory map, etc.) and
 * pass it back to `get` / `refresh` / `delete`.
 *
 * Auth via injected `TokenProvider`: production wiring passes a provider
 * backed by google-auth-library + buildVertexAuthOptions (DB-seeded SA or
 * ADC). Local integration tests pass a provider backed by
 * `gcloud auth print-access-token`.
 *
 * Source: https://ai.google.dev/gemini-api/docs/caching
 *         https://cloud.google.com/vertex-ai/generative-ai/docs/context-cache/context-cache-overview
 */

export interface TokenProvider {
  getAccessToken(): Promise<string>;
}

export interface CreateCacheInput {
  model: string;
  /**
   * System instruction string. Counts toward the minimum cache size.
   * Inlined as `systemInstruction: { parts: [{ text }] }` on the wire.
   */
  systemInstruction?: string;
  /**
   * Multi-turn conversation prefix to cache. Each entry must already be
   * in Vertex Gemini's content shape: `{ role, parts: [{ text }] }`.
   */
  contents?: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>;
  /**
   * Optional tool definitions to cache alongside system + contents.
   * Vertex Gemini tool shape: `[{ functionDeclarations: [...] }]`.
   */
  tools?: Array<{
    functionDeclarations: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
  }>;
  /**
   * Cache lifetime in seconds. Vertex AI default is 60 minutes; max is
   * provider-dependent (typically 1h). After this expires the resource
   * is auto-deleted by Vertex.
   */
  ttlSeconds: number;
  /** Optional human-readable label visible in Vertex console. */
  displayName?: string;
}

export interface CachedContent {
  /** Canonical resource name: `projects/{P}/locations/{L}/cachedContents/{ID}`. */
  name: string;
  /** Fully-qualified model reference used to create the cache. */
  model: string;
  displayName?: string;
  createTime: string;
  updateTime: string;
  /** ISO 8601 timestamp — when Vertex will auto-delete the cache. */
  expireTime: string;
  usageMetadata?: {
    totalTokenCount?: number;
  };
}

export interface GeminiCacheManagerDeps {
  project: string;
  location: string;
  tokenProvider: TokenProvider;
  /** Override base URL for testing against staging endpoints. */
  baseUrl?: string;
}

export class GeminiCacheManager {
  private readonly base: string;

  constructor(private readonly deps: GeminiCacheManagerDeps) {
    this.base =
      deps.baseUrl ??
      `https://${deps.location}-aiplatform.googleapis.com/v1/projects/${deps.project}/locations/${deps.location}/cachedContents`;
  }

  /**
   * Build the model reference Vertex wants on the cachedContents create
   * body. Accepts either a short name OR a fully-qualified path
   * (`projects/.../publishers/google/models/...`) — short form is
   * rewritten to the full Vertex publisher path. Caller supplies the
   * specific model name; the manager itself is model-agnostic.
   */
  private resolveModel(model: string): string {
    if (model.startsWith('projects/')) return model;
    return `projects/${this.deps.project}/locations/${this.deps.location}/publishers/google/models/${model}`;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.deps.tokenProvider.getAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  async create(input: CreateCacheInput): Promise<CachedContent> {
    const body: Record<string, unknown> = {
      model: this.resolveModel(input.model),
      ttl: `${input.ttlSeconds}s`,
    };
    if (input.systemInstruction) {
      body.systemInstruction = { parts: [{ text: input.systemInstruction }] };
    }
    if (input.contents && input.contents.length > 0) {
      body.contents = input.contents;
    }
    if (input.tools && input.tools.length > 0) {
      body.tools = input.tools;
    }
    if (input.displayName) {
      body.displayName = input.displayName;
    }

    const headers = await this.authHeaders();
    const res = await fetch(this.base, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GeminiCacheManager.create failed (${res.status}): ${text}`);
    }
    return (await res.json()) as CachedContent;
  }

  async get(name: string): Promise<CachedContent> {
    const url = this.resourceUrl(name);
    const headers = await this.authHeaders();
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GeminiCacheManager.get failed (${res.status}): ${text}`);
    }
    return (await res.json()) as CachedContent;
  }

  /**
   * PATCH the resource to extend its TTL. Vertex requires `updateMask=ttl`
   * on the query string to scope the patch to just the TTL field.
   */
  async refresh(name: string, ttlSeconds: number): Promise<CachedContent> {
    const url = this.resourceUrl(name) + '?updateMask=ttl';
    const headers = await this.authHeaders();
    const res = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ ttl: `${ttlSeconds}s` }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GeminiCacheManager.refresh failed (${res.status}): ${text}`);
    }
    return (await res.json()) as CachedContent;
  }

  async delete(name: string): Promise<void> {
    const url = this.resourceUrl(name);
    const headers = await this.authHeaders();
    const res = await fetch(url, { method: 'DELETE', headers });
    if (!res.ok && res.status !== 404) {
      const text = await res.text();
      throw new Error(`GeminiCacheManager.delete failed (${res.status}): ${text}`);
    }
  }

  /**
   * Resolve a resource name to its REST URL. Accepts the canonical
   * `projects/.../cachedContents/{ID}` form; treats the cache ID alone
   * as a shorthand under the configured project/location.
   */
  private resourceUrl(name: string): string {
    if (name.startsWith('projects/')) {
      // Strip the host-less prefix and use the configured regional endpoint.
      return `https://${this.deps.location}-aiplatform.googleapis.com/v1/${name}`;
    }
    return `${this.base}/${name}`;
  }
}
