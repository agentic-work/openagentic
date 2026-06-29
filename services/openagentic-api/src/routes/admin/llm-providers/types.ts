/**
 * Shared option / request types for the admin LLM-provider route sub-modules.
 *
 * Extracted from the former monolithic routes/admin/llm-providers.ts during the
 * per-domain decomposition. Behaviour-preserving: the `any` value-bags the
 * handlers used were narrowed to typed, runtime-identical equivalents (typed
 * known fields + an `unknown` index signature) so reads compile without casts
 * erasing all safety.
 */
import type { ProviderManager } from '../../../services/llm-providers/ProviderManager.js';
import type { ModelDiscoveryRecord } from '../../../services/llm-providers/discovery/ModelDiscoveryRecord.js';

/**
 * Options every llm-provider sub-plugin receives from the parent registrar.
 *
 * CRITICAL: the parent barrel passes the SAME singleton ProviderManager to
 * every sub-plugin so admin CRUD reloads the exact instance the chat path
 * uses — edits therefore invalidate chat-side provider/model caches.
 */
export interface ProviderRoutesOptions {
  providerManager?: ProviderManager;
}

/**
 * Permissive structural view over a provider's `provider_config` JSON column.
 * Known fields are typed; everything else falls through the `unknown` index
 * signature. Runtime-identical to the old `(x.provider_config as any)` reads.
 */
export interface ProviderConfigBag {
  host?: string;
  endpoint?: string;
  endpointUrl?: string;
  ollamaHost?: string;
  baseUrl?: string;
  deployment?: string;
  deploymentName?: string;
  projectId?: string;
  location?: string;
  region?: string;
  modelId?: string;
  apiVersion?: string;
  models?: unknown;
  origin?: Record<string, string | undefined>;
  lastDiscoveryAt?: string;
  lastTestAt?: string;
  seeder_managed?: boolean;
  [key: string]: unknown;
}

/** Permissive structural view over a provider's `auth_config` JSON column. */
export interface AuthConfigBag {
  type?: string;
  apiKey?: string;
  key?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  clientId?: string;
  clientSecret?: string;
  credentials?: unknown;
  serviceAccountKey?: unknown;
  serviceAccountPath?: string;
  serviceAccountCredentials?: unknown;
  region?: string;
  tenantId?: string;
  endpoint?: string;
  endpointUrl?: string;
  apiVersion?: string;
  [key: string]: unknown;
}

/**
 * Loose view over a model record as the handlers read it (discovery results,
 * registry rows mapped to model shapes, catalog entries). Runtime-identical to
 * the old `any` model bags — typed known fields + `unknown` index signature.
 */
export interface ModelLike {
  id?: string;
  name?: string;
  family?: string;
  tier?: string;
  capabilities?: Record<string, unknown>;
  maxTokens?: number;
  contextWindow?: number;
  maxOutputTokens?: number;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Loose runtime view of an in-memory provider instance. The concrete provider
 * classes expose a superset of {@link ILLMProvider}; handlers also call a few
 * subclass-only methods (ensureArmDeployment, generateEmbedding). All methods
 * are optional so a cast to this type compiles without erasing to `any`.
 */
export interface ProviderRuntime {
  type?: string;
  initialize?(config?: unknown): Promise<void>;
  listModels?(): Promise<unknown[]>;
  discoverModels?(): Promise<unknown[]>;
  discoverModelDetails?(modelId: string, region?: string): Promise<ModelDiscoveryRecord | null>;
  getModelDefaults?(modelId: string): Promise<Record<string, unknown> | null>;
  createCompletion?(request: unknown): Promise<unknown>;
  getHealth?(): Promise<unknown>;
  ensureArmDeployment?(args: Record<string, unknown>): Promise<unknown>;
  generateEmbedding?(text: string): Promise<number[]>;
}

/**
 * Loose view over an LLM completion response / stream chunk as the test +
 * playground handlers read it (OpenAI-ish shape). Used in place of the old
 * `(response as any).choices?.[0]?...` casts.
 */
export interface CompletionResultLike {
  choices?: Array<{
    message?: { content?: string; tool_calls?: unknown[]; thinking?: unknown };
    delta?: { content?: string };
  }>;
  usage?: Record<string, unknown> | null;
  thinking?: unknown;
  thinkingContent?: unknown;
  content?: string;
  [key: string]: unknown;
}

/** Permissive structural view over a provider's `model_config` JSON column. */
export interface ModelConfigBag {
  chatModel?: string;
  embeddingModel?: string;
  visionModel?: string;
  imageModel?: string;
  compactionModel?: string;
  defaultModel?: string;
  additionalModels?: string[];
  disabledModels?: string[];
  _disabled?: Record<string, unknown>;
  maxTokens?: number;
  maxOutputTokens?: number;
  contextWindow?: number;
  temperature?: number;
  models?: unknown;
  [key: string]: unknown;
}
