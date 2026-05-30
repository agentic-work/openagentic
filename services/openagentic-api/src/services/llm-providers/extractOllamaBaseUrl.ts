/**
 * extractOllamaBaseUrl — single source of truth for "where do I reach this
 * Ollama host?". Used by NEW admin-ollama call sites added in Phase 3.
 * Existing call sites (admin-ollama.ts:40,61 / OllamaModelSyncService.ts:127)
 * use defensive inline extension per spec — see commit history.
 *
 * Read order: provider_config → auth_config → throws.
 * No literal fallbacks: callers that have no URL must surface that as an
 * error, not silently hit localhost.
 */
export function extractOllamaBaseUrl(provider: { provider_config?: any; auth_config?: any }): string {
  const pc = provider.provider_config || {};
  const ac = provider.auth_config || {};
  const url = pc.baseUrl || pc.host || pc.endpoint || ac.baseUrl || ac.endpoint;
  if (!url) {
    throw new Error('extractOllamaBaseUrl: no Ollama base URL found in provider_config or auth_config');
  }
  return url;
}
