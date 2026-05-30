/**
 * Map an LLM provider's `provider_type` (admin.llm_providers row) to the
 * `EmbeddingProvider` discriminator UniversalEmbeddingService expects.
 *
 * Why this is its own file:
 * - The mapping used to be an inline `providerMap` object inside
 *   startup/04-providers.ts. The omission of `azure-ai-foundry` caused
 *   AIF rows to fall through the `||` to `'openai-compatible'`, which
 *   demands `EMBEDDING_API_KEY`. AIF authenticates via Entra ID with no
 *   API key — UniversalEmbeddingService's `azure-openai` branch already
 *   handles Entra auth, so the right move is to map AIF → azure-openai.
 * - Live failure (2026-05-04, fresh-DB cold-boot post-AIF bootstrap):
 *     Error: OpenAI-compatible requires EMBEDDING_ENDPOINT and EMBEDDING_API_KEY
 *       at UniversalEmbeddingService.loadProviderConfig
 *       at startup/05-milvus.ts (CRITICAL startup failure → CrashLoopBackOff)
 * - Pulling the mapping into a pure helper makes it unit-testable without
 *   the prisma + DefaultAzureCredential blast radius of 04-providers.ts.
 */

import type { EmbeddingProvider } from '../UniversalEmbeddingService.js';

const PROVIDER_TYPE_TO_EMBEDDING: Record<string, EmbeddingProvider> = {
  'azure-openai': 'azure-openai',
  // AIF speaks the Azure OpenAI REST protocol; Entra auth is the default.
  // UniversalEmbeddingService's azure-openai branch resolves Entra creds
  // from AZURE_TENANT_ID / AZURE_CLIENT_ID / AZURE_CLIENT_SECRET when
  // AZURE_OPENAI_API_KEY is absent.
  'azure-ai-foundry': 'azure-openai',
  'vertex-ai': 'vertex-ai',
  'aws-bedrock': 'aws-bedrock',
  'ollama': 'ollama',
  'openai': 'openai-compatible',
  'anthropic': 'openai-compatible',
};

/**
 * Map admin.llm_providers.provider_type to UniversalEmbeddingService's
 * EmbeddingProvider tag. Falls back to 'openai-compatible' for unknown
 * types (preserves the prior behavior — an admin who adds a generic
 * OpenAI-compatible provider expects API-key-flavored embedding auth).
 */
export function mapLlmProviderTypeToEmbeddingProvider(providerType: string): EmbeddingProvider {
  return PROVIDER_TYPE_TO_EMBEDDING[providerType] ?? 'openai-compatible';
}
