/**
 * Azure AI Foundry Provider
 *
 * Implements ILLMProvider for Azure AI Foundry serverless models (Mistral, Llama, Claude, etc.)
 * Supports BOTH OpenAI-compatible and Anthropic API formats
 * PAYG billing with no quota limits - 200K TPM per deployment
 *
 * API Format Auto-Detection:
 * - If endpoint contains '/anthropic/', uses Anthropic Messages API format
 * - Otherwise, uses OpenAI-compatible Azure AI Model Inference API
 *
 * Supports BOTH authentication methods:
 * - API Key authentication (api-key header)
 * - Entra ID authentication (Azure AD bearer token)
 */

import type { Logger } from 'pino';
import {
  BaseLLMProvider,
  type CompletionRequest,
  type CompletionResponse,
  type ProviderHealth,
  type ProviderConfig,
  type DiscoveredModel,
} from './ILLMProvider.js';
import type { CanonicalStreamFormat } from '@agentic-work/llm-sdk/lib/normalizers/index.js';
import AnthropicFoundry from '@anthropic-ai/foundry-sdk';
import { getBearerTokenProvider, DefaultAzureCredential, ClientSecretCredential } from '@azure/identity';
import { fetchWithRetry } from './fetchWithRetry.js';
// Phase 0.4 — SDK outbound adapter is SoT for AIF Responses API wire body.
// The 220-LOC in-class `buildResponsesApiBody` is DELETED; this thin helper
// wraps `selectOutboundAdapter('aif-responses')` and layers AIF-specific
// decoration (deployment as model, reasoning.effort, max_output_tokens,
// AIF-strict JSON Schema normalization on tools).
import { buildAifResponsesBody } from './aif/buildAifResponsesBody.js';
// Phase 0.4 (2026-05-12) — Chat Completions path through SDK 'openai'
// adapter with AIF model-family surgery (gpt-5 temperature strip,
// o-series no top_p, max_completion_tokens vs max_tokens). Replaces
// the inline body construction in createOpenAICompletion. The
// in-class `convertAnthropicMessagesToOpenAI` (~157 LOC) is now called
// transitively through `completionRequestToCanonical` in the helper.
import { buildAifChatCompletionsBody } from './aif/buildAifChatCompletionsBody.js';
// Phase 0.4 — AIF Anthropic paths (createAnthropicCompletion +
// createAIFAnthropicCompletion) share the same Anthropic Messages wire
// shape via the SDK 'anthropic' adapter (verified by REAL Bedrock
// round-trip in buildAnthropicWireBody.real.test.ts).
import { buildAnthropicWireBody } from './anthropic/buildAnthropicWireBody.js';

// Responses API gate. Two reasons a deployment routes to /openai/v1/responses:
//
//   1. REQUIRED — Chat Completions returns 400 "The requested operation is
//      unsupported." for the deployment. Historical set: gpt-5-codex family,
//      gpt-5-pro, o1-pro, o3-pro.
//   2. REASONING — the deployment SUPPORTS Chat Completions but emits no
//      reasoning content there. Reasoning chunks (summary deltas) are only
//      exposed via Responses API. Verified 2026-05-10 by real-provider probe
//      against AIF gpt-5.4 (Chat Completions: 0 reasoning_content; Responses:
//      thinking_delta canonical events emit). Without this gate, gpt-5.4
//      chat in the dev environment never streams thinking deltas to the wire — exactly
//      the symptom the user flagged.
//
// Keep this regex the single source of truth; never scatter model literals.
const RESPONSES_API_REQUIRED_PATTERN = /^(gpt-5.*-codex|gpt-5-pro|gpt-5(?:[.-]\d+(?:[.-]\w+)*)?(?:-mini|-nano)?|o1-pro|o3-pro)$/i;

/**
 * Normalize a tool's `parameters` JSON Schema into a form Azure AIF
 * accepts on BOTH the Chat Completions and Responses APIs.
 *
 * Azure rejects entire requests with 400
 *   "Invalid schema for function 'X': schema must be a JSON Schema of
 *    'type: \"object\"', got 'type: \"None\"'."
 * whenever any tool's parameters lacks a top-level `type: "object"`. This
 * happens for:
 *   - Anthropic-shape tools that omit `type` on the input_schema
 *   - zod `discriminatedUnion` tools that serialize to `{anyOf:[...]}`
 *     with no top-level type (the openagentic `TailServeLog` case that
 *     repro'd 2026-05-05)
 *   - MCP tools with empty / null parameters
 *
 * One bad tool kills the whole tool array, so this MUST be applied
 * before sending tools to AIF on every code path.
 */
const FORBIDDEN_TOOL_PARAM_KEYWORDS = ['oneOf', 'anyOf', 'allOf', 'enum', 'not'] as const;
export function normalizeAifToolParameters(raw: unknown): Record<string, unknown> {
  const empty = (): Record<string, unknown> => ({
    type: 'object',
    properties: {},
    additionalProperties: false,
  });
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return empty();
  const obj: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
  let stripped = false;
  for (const k of FORBIDDEN_TOOL_PARAM_KEYWORDS) {
    if (k in obj) {
      delete obj[k];
      stripped = true;
    }
  }
  if (typeof obj.type !== 'string') obj.type = 'object';
  if (obj.type !== 'object') {
    // Top-level type "string"/"array"/etc. — wrap as a single value prop.
    return { type: 'object', properties: { value: raw }, required: ['value'] };
  }
  if (
    obj.properties === undefined ||
    obj.properties === null ||
    typeof obj.properties !== 'object' ||
    Array.isArray(obj.properties)
  ) {
    obj.properties = {};
  }
  if (stripped && Object.keys(obj.properties as Record<string, unknown>).length === 0) {
    obj.additionalProperties = obj.additionalProperties ?? true;
  }
  return obj;
}

/** Pick the model id to use for an AIF health probe. Prefers the first
 *  ARM-discovered deployment (which we know exists in this AIF account)
 *  over the configured fallback — `this.model` can fall through to
 *  DEFAULT_MODEL=gpt-oss:20b which AIF doesn't have, producing 404. (#370) */
export function pickHealthProbeModel(
  discovered: Array<{ id: string }>,
  fallback: string | undefined,
): string {
  if (Array.isArray(discovered) && discovered.length > 0 && discovered[0]?.id) {
    return discovered[0].id;
  }
  return fallback || '';
}

/**
 * Convert Anthropic-shape messages to OpenAI chat-completions shape for AIF.
 *
 * Why this exists: callers that forward messages in Anthropic shape
 * (content arrays with `tool_use`/`tool_result` blocks) hit AIF's
 * chat-completions API, which rejects that shape with strict 400s.
 * This converter:
 *
 *   1. Splits `{role:'user', content:[{type:'tool_result',...}, ...]}`
 *      into one OpenAI `{role:'tool', tool_call_id, content}` per result.
 *   2. Folds `{role:'assistant', content:[{type:'text'}, {type:'tool_use'}]}`
 *      into `{role:'assistant', content:'<text>', tool_calls:[{id, type:'function',
 *      function:{name, arguments}}]}` — OpenAI requires tool_calls as a
 *      sibling of `content`, not nested inside.
 *   3. **Merges consecutive assistant tool_use messages into a single
 *      assistant message with all parallel tool_calls in one tool_calls[]
 *      array.** Anthropic transcripts persist parallel batches as separate
 *      rows (one assistant message per `tool_use` block); AIF requires
 *      ONE assistant message per parallel batch, otherwise the orphan
 *      tool messages downstream fail validation.
 *   4. Pre-existing OpenAI-shape messages (`{role:'tool', tool_call_id,...}`
 *      or assistant with `tool_calls`) pass through unchanged.
 *
 * The bug-fix that motivated this (2026-05-06): Sonnet/Anthropic accepts
 * the un-merged shape, so it never surfaced on Anthropic-format providers.
 * When Smart Router routed a session with parallel tool batches in its
 * JSONL transcript to AIF (gpt-5.4), AIF's stricter validator returned
 * 400 every retry → daemon error→result loop → silent UI hang.
 */
export function convertAnthropicMessagesToOpenAI(
  input: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];

  const isToolUseBlock = (b: any) =>
    b && typeof b === 'object' && b.type === 'tool_use';
  const isToolResultBlock = (b: any) =>
    b && typeof b === 'object' && b.type === 'tool_result';
  const isTextBlock = (b: any) =>
    b && typeof b === 'object' && b.type === 'text';
  const isThinkingBlock = (b: any) =>
    b && typeof b === 'object' && (b.type === 'thinking' || b.type === 'redacted_thinking');

  const stringifyResult = (raw: unknown): string => {
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) {
      // Anthropic tool_result.content can be an array of {type:'text',text}.
      return raw
        .map((p: any) => (typeof p === 'string' ? p : (p?.text ?? JSON.stringify(p))))
        .join('\n');
    }
    return JSON.stringify(raw ?? '');
  };

  for (const msg of input || []) {
    const role = (msg as any).role as string | undefined;
    const content = (msg as any).content;

    // ── pass-through: existing OpenAI-shape tool message ──────────────
    if (role === 'tool' && typeof (msg as any).tool_call_id === 'string') {
      out.push({
        role: 'tool',
        tool_call_id: (msg as any).tool_call_id,
        content:
          typeof content === 'string' ? content : stringifyResult(content),
      });
      continue;
    }

    // ── pass-through: existing OpenAI-shape assistant w/ tool_calls ───
    if (role === 'assistant' && Array.isArray((msg as any).tool_calls)) {
      // If the previous emitted message is also assistant+tool_calls AND
      // there's no intervening tool/user message, MERGE them into a
      // single tool_calls[] array (parallel-batch fold).
      const prev = out[out.length - 1];
      if (
        prev &&
        prev.role === 'assistant' &&
        Array.isArray((prev as any).tool_calls) &&
        // Only merge if neither has substantive text content
        (!prev.content || prev.content === '') &&
        !((msg as any).content)
      ) {
        (prev as any).tool_calls = [
          ...((prev as any).tool_calls as any[]),
          ...((msg as any).tool_calls as any[]),
        ];
      } else {
        out.push({
          role: 'assistant',
          content: typeof (msg as any).content === 'string' ? (msg as any).content : '',
          tool_calls: (msg as any).tool_calls,
        });
      }
      continue;
    }

    // ── system → pass through (string content) ─────────────────────────
    if (role === 'system') {
      out.push({
        role: 'system',
        content:
          typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content.map((b: any) => (isTextBlock(b) ? b.text : '')).filter(Boolean).join('\n')
              : '',
      });
      continue;
    }

    // ── user with array content: split tool_result blocks out as tool messages ──
    if (role === 'user') {
      if (typeof content === 'string') {
        out.push({ role: 'user', content });
        continue;
      }
      if (Array.isArray(content)) {
        const textParts: string[] = [];
        // Multimodal drag-drop fix (2026-05-08): preserve image_url blocks
        // (and Anthropic-style {type:'image', source:{base64,…}}) so the
        // model actually receives the image bytes. Without this the V2
        // pipeline's `[{type:'text'}, {type:'image_url'}]` content array
        // collapsed to a text-only string and the model replied "please
        // upload the image first." OpenAI Chat Completions expects content
        // to STAY an array `[{type:'text', text}, {type:'image_url',
        // image_url:{url:'data:…'}}]` for multimodal turns.
        const imageBlocks: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
        for (const block of content) {
          if (isToolResultBlock(block)) {
            const toolCallId = (block as any).tool_use_id;
            if (typeof toolCallId !== 'string' || toolCallId.length === 0) continue;
            out.push({
              role: 'tool',
              tool_call_id: toolCallId,
              content: stringifyResult(
                (block as any).content !== undefined ? (block as any).content : (block as any).text,
              ),
            });
          } else if (isTextBlock(block)) {
            textParts.push((block as any).text || '');
          } else if ((block as any)?.type === 'image_url' && (block as any).image_url?.url) {
            imageBlocks.push({
              type: 'image_url',
              image_url: { url: String((block as any).image_url.url) },
            });
          } else if ((block as any)?.type === 'image' && (block as any).source) {
            // Anthropic-shape image block — translate `{source:{type:'base64',
            // media_type, data}}` to OpenAI `{image_url:{url:'data:…'}}`.
            const src = (block as any).source;
            if (src.type === 'base64' && src.media_type && src.data) {
              imageBlocks.push({
                type: 'image_url',
                image_url: { url: `data:${src.media_type};base64,${src.data}` },
              });
            } else if (src.type === 'url' && src.url) {
              imageBlocks.push({
                type: 'image_url',
                image_url: { url: String(src.url) },
              });
            }
          } else if (typeof block === 'string') {
            textParts.push(block);
          }
        }
        if (imageBlocks.length > 0) {
          // Multimodal turn — emit content as an array preserving the
          // image bytes. Text blocks come first (matches OpenAI examples).
          const blocks: Array<any> = [];
          if (textParts.length > 0) {
            blocks.push({ type: 'text', text: textParts.join('\n') });
          }
          blocks.push(...imageBlocks);
          out.push({ role: 'user', content: blocks });
        } else if (textParts.length > 0) {
          out.push({ role: 'user', content: textParts.join('\n') });
        }
        continue;
      }
      // Defensive: unknown content shape — skip rather than send invalid.
      continue;
    }

    // ── assistant with array content: peel out tool_use into tool_calls,
    //    then merge with prior assistant if appropriate ─────────────────
    if (role === 'assistant') {
      if (typeof content === 'string') {
        out.push({ role: 'assistant', content });
        continue;
      }
      if (Array.isArray(content)) {
        const textParts: string[] = [];
        const toolCalls: any[] = [];
        for (const block of content) {
          if (isToolUseBlock(block)) {
            const id = (block as any).id;
            if (typeof id !== 'string' || id.length === 0) continue;
            const inputObj = (block as any).input;
            const args =
              typeof inputObj === 'string'
                ? inputObj
                : JSON.stringify(inputObj ?? {});
            toolCalls.push({
              id,
              type: 'function',
              function: {
                name: (block as any).name || '',
                arguments: args,
              },
            });
          } else if (isTextBlock(block)) {
            textParts.push((block as any).text || '');
          } else if (isThinkingBlock(block)) {
            // Drop thinking blocks for OpenAI shape — they're not valid
            // assistant content for chat-completions and the model never
            // needs its own prior thinking to continue.
            continue;
          }
        }
        const text = textParts.join('\n');
        // Parallel-batch merge: if the previous emitted message is also
        // assistant with tool_calls and no text, fold this turn's tool_calls
        // into it. Otherwise emit a fresh assistant message.
        const prev = out[out.length - 1];
        const canMerge =
          prev &&
          prev.role === 'assistant' &&
          Array.isArray((prev as any).tool_calls) &&
          (!prev.content || prev.content === '') &&
          text === '' &&
          toolCalls.length > 0;
        if (canMerge) {
          (prev as any).tool_calls = [
            ...((prev as any).tool_calls as any[]),
            ...toolCalls,
          ];
        } else if (toolCalls.length > 0 || text.length > 0) {
          const m: Record<string, unknown> = { role: 'assistant', content: text };
          if (toolCalls.length > 0) m.tool_calls = toolCalls;
          out.push(m);
        }
        continue;
      }
    }

    // ── unknown / other → pass through verbatim ───────────────────────
    out.push(msg);
  }

  return out;
}

export class AzureAIFoundryProvider extends BaseLLMProvider {
  readonly name = 'azure-ai-foundry';
  readonly type = 'azure-openai' as const; // Type constraint workaround
  // D-1.2 — AIF is multi-mode. The static default 'openai' covers the
  // ProviderManager.ts:1180-1181 callsite that has no per-request context;
  // multi-mode dispatch uses `getStreamFormat(request)` below.
  readonly streamFormat = 'openai' as const;

  /**
   * Per-request stream-format dispatch (D-1.2).
   *
   * Mirrors the runtime branch at AzureAIFoundryProvider.ts:1273-1289
   * (Anthropic-track) and :1746 (Responses API track):
   *
   *   1. shouldUseResponsesApi(model) → 'aif-responses'
   *      (model is an AIF Responses-API-required model — codex / pro)
   *   2. isAnthropicFormat OR model name contains 'claude' → 'foundry-anthropic'
   *      (either the AIF endpoint URL is /anthropic/-shaped, OR the Claude
   *      deployment is reached via per-request Anthropic Messages API)
   *   3. otherwise → 'openai'
   *      (default OpenAI Chat Completions wire)
   *
   * The pipeline calls `selectCanonicalNormalizer(this.getStreamFormat(req))`
   * once per request to pick the correct SDK normalizer.
   */
  getStreamFormat(request: CompletionRequest): CanonicalStreamFormat {
    const modelName = (request.model || this.model || '').toLowerCase();
    if (this.shouldUseResponsesApi(modelName)) {
      return 'aif-responses';
    }
    if (this.isAnthropicFormat || modelName.includes('claude')) {
      return 'foundry-anthropic';
    }
    return 'openai';
  }
  private endpointUrl: string;
  private apiKey: string;
  private model: string;
  private requestTimeout: number; // Timeout for fetch requests in milliseconds
  private apiVersion: string; // API version for Azure OpenAI endpoints
  // (#71) Use the unified Foundry inference endpoint instead of per-deployment.
  // When true, getEndpointUrl() returns {base}/models/chat/completions and the
  // model name is passed in the request body. Lets you use ANY catalog model
  // (Claude, Mistral, Llama, etc.) without per-model deployments — just a
  // one-time marketplace subscription accept in Azure portal.
  // For Azure OpenAI models (GPT-5, etc.) the per-deployment path is still
  // required (Azure constraint, not ours). Admin gets a clear error.
  private useUnifiedEndpoint: boolean;

  // API format detection
  private isAnthropicFormat: boolean;
  private anthropicClient?: AnthropicFoundry;

  // Smart model selection configuration
  private functionCallingModel: string; // GPT-5 or specific model for function calling
  private preferSpecificModel: boolean; // If true, avoid model-router for function calling
  private excludedModels: string[]; // Models to exclude from selection (e.g., DeepSeek)

  // Entra ID (Azure AD) authentication
  private useEntraAuth: boolean;
  // Ambient-login fallback: when NEITHER an API key NOR an Entra app
  // (tenant+client+secret) is configured, authenticate via DefaultAzureCredential
  // so a mounted host ~/.azure (az login) resolves a bearer token.
  private useDefaultAzureCredential: boolean;
  private defaultAzureCredential?: DefaultAzureCredential;
  private tenantId?: string;
  private clientId?: string;
  private clientSecret?: string;
  private tokenCache?: { token: string; expiresAt: number };

  constructor(logger: Logger, config?: {
    endpointUrl?: string;
    apiKey?: string;
    model?: string;
    functionCallingModel?: string;
    preferSpecificModel?: boolean;
    excludedModels?: string[];
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;
    requestTimeout?: number;
    apiVersion?: string;
    useUnifiedEndpoint?: boolean;
  }) {
    super(logger, 'azure-ai-foundry');
    this.endpointUrl = config?.endpointUrl || process.env.AIF_ENDPOINT_URL || '';
    this.apiKey = config?.apiKey || process.env.AIF_API_KEY || '';
    this.model = config?.model || process.env.AIF_MODEL || process.env.DEFAULT_MODEL;
    // 2026-05-12 — DB is the SoT for providers/models. Runtime READS ONLY
    // from `config.apiVersion` (the DB row's stored value), never from
    // env. env is the seeder's input for FIRST DB write; after that the
    // DB row owns its value and admin edits via /api/admin/llm-providers
    // are the only way to change it. User mandate: "fuck env vars winning
    // anything in the tug o war with the DB SOT for providers/models".
    // Source default fires only when DB row genuinely lacks apiVersion
    // (test paths, pre-seed instantiation).
    this.apiVersion = config?.apiVersion || '2024-12-01-preview';
    this.useUnifiedEndpoint = config?.useUnifiedEndpoint ?? (process.env.AIF_USE_UNIFIED_ENDPOINT === 'true');

    // Timeout configuration - default 120 seconds (Anthropic Claude with many tools can be slow)
    // Can be overridden via config or environment variable
    this.requestTimeout = config?.requestTimeout ||
                          Number.parseInt(process.env.AIF_REQUEST_TIMEOUT || '120000', 10);

    // Detect API format from endpoint URL
    this.isAnthropicFormat = this.endpointUrl.includes('/anthropic/');

    // Smart model selection for function calling
    // Use a specific model (like gpt-5) for function calling instead of model-router
    // Research shows model-router may select gpt-5-mini which has poor function calling
    this.functionCallingModel = config?.functionCallingModel || process.env.AIF_FUNCTION_CALLING_MODEL || this.model;
    this.preferSpecificModel = config?.preferSpecificModel ?? (process.env.AIF_PREFER_SPECIFIC_MODEL === 'true');

    // Model exclusions (e.g., to avoid DeepSeek if tool call parsing is problematic)
    // Can be configured via environment variable: AIF_EXCLUDED_MODELS=deepseek,other-model
    const excludedModelsEnv = process.env.AIF_EXCLUDED_MODELS?.split(',').map(m => m.trim().toLowerCase()) || [];
    this.excludedModels = config?.excludedModels?.map(m => m.toLowerCase()) || excludedModelsEnv;

    // Entra ID credentials (optional - falls back to API key if not provided)
    this.tenantId = config?.tenantId || process.env.AIF_TENANT_ID;
    this.clientId = config?.clientId || process.env.AIF_CLIENT_ID;
    this.clientSecret = config?.clientSecret || process.env.AIF_CLIENT_SECRET;

    // Determine auth method: Entra ID if credentials present, otherwise API key
    this.useEntraAuth = !!(this.tenantId && this.clientId && this.clientSecret);

    // Ambient-login fallback: with NEITHER an API key NOR a full Entra app, use
    // DefaultAzureCredential so a mounted host ~/.azure (az login) authenticates.
    this.useDefaultAzureCredential = !this.useEntraAuth && !this.apiKey && !!this.endpointUrl;
    if (this.useDefaultAzureCredential) {
      this.defaultAzureCredential = new DefaultAzureCredential();
    }

    // Initialize Anthropic client if using Anthropic format
    if (this.isAnthropicFormat) {
      // Normalize endpoint URL - should end with /anthropic/ not /anthropic/v1/messages
      let baseURL = this.endpointUrl;
      if (baseURL.includes('/v1/messages')) {
        baseURL = baseURL.replace(/\/v1\/messages.*$/, '/');
      } else if (!baseURL.endsWith('/')) {
        baseURL += '/';
      }

      if (this.useEntraAuth && this.tenantId && this.clientId && this.clientSecret) {
        // Use Azure AD authentication with token provider
        const credential = new ClientSecretCredential(
          this.tenantId,
          this.clientId,
          this.clientSecret
        );
        const tokenProvider = getBearerTokenProvider(
          credential,
          'https://cognitiveservices.azure.com/.default'
        );

        this.anthropicClient = new AnthropicFoundry({
          azureADTokenProvider: tokenProvider,
          baseURL: baseURL,
          timeout: this.requestTimeout,
          maxRetries: 0 // Disable retries - fail fast
        });

        this.logger.info({
          baseURL: baseURL.replace(/https:\/\/([^.]+)/, 'https://***'),
          authMethod: 'Azure AD Token Provider',
          timeout: this.requestTimeout
        }, '[AzureAIFoundryProvider] Initialized Anthropic client with Azure AD');
      } else if (this.useDefaultAzureCredential && this.defaultAzureCredential) {
        // Ambient az login (mounted ~/.azure) via DefaultAzureCredential.
        const tokenProvider = getBearerTokenProvider(
          this.defaultAzureCredential,
          'https://cognitiveservices.azure.com/.default'
        );

        this.anthropicClient = new AnthropicFoundry({
          azureADTokenProvider: tokenProvider,
          baseURL: baseURL,
          timeout: this.requestTimeout,
          maxRetries: 0 // Disable retries - fail fast
        });

        this.logger.info({
          baseURL: baseURL.replace(/https:\/\/([^.]+)/, 'https://***'),
          authMethod: 'DefaultAzureCredential (az login)',
          timeout: this.requestTimeout
        }, '[AzureAIFoundryProvider] Initialized Anthropic client with DefaultAzureCredential');
      } else if (this.apiKey) {
        // Fallback to API key (may not work for Azure AI Foundry)
        this.anthropicClient = new AnthropicFoundry({
          apiKey: this.apiKey,
          baseURL: baseURL,
          timeout: this.requestTimeout,
          maxRetries: 0 // Disable retries - fail fast
        });

        this.logger.warn({
          baseURL: baseURL.replace(/https:\/\/([^.]+)/, 'https://***'),
          authMethod: 'API Key (may not work)',
          timeout: this.requestTimeout
        }, '[AzureAIFoundryProvider] Initialized Anthropic client with API key - Azure AD recommended');
      }
    }

    if (!this.endpointUrl) {
      this.logger.warn('[AzureAIFoundryProvider] Missing endpoint URL - provider will not be functional');
    } else if (!this.useEntraAuth && !this.apiKey && !this.useDefaultAzureCredential) {
      this.logger.warn('[AzureAIFoundryProvider] Missing API key, Entra ID credentials, and ambient Azure login - provider will not be functional');
    } else {
      this.initialized = true;
    }

    this.logger.info({
      endpointUrl: this.endpointUrl.replace(/https:\/\/([^.]+)/, 'https://***'),
      model: this.model,
      apiFormat: this.isAnthropicFormat ? 'Anthropic Messages API' : 'OpenAI Compatible',
      authMethod: this.useEntraAuth ? 'Entra ID (Azure AD)' : 'API Key',
      hasApiKey: !!this.apiKey,
      hasEntraCredentials: this.useEntraAuth,
      requestTimeoutMs: this.requestTimeout,
      excludedModels: this.excludedModels.length > 0 ? this.excludedModels : 'none'
    }, '[AzureAIFoundryProvider] Initialized');
  }

  // Stored DB provider_config — populated by initialize(), used by listModels()
  private providerDbConfig: Record<string, any> = {};
  private discoveredModels: Array<{ id: string; name: string; provider: string }> = [];

  async initialize(config: ProviderConfig['config']): Promise<void> {
    if (config && typeof config === 'object') {
      this.providerDbConfig = config as Record<string, any>;
    }
    if (this.endpointUrl && (this.apiKey || this.useEntraAuth || this.useDefaultAzureCredential)) {
      this.initialized = true;

      // Auto-discover deployed models at startup via ARM management API
      try {
        const deployments = await this.listDeploymentsViaARM();
        if (deployments.length > 0) {
          this.discoveredModels = deployments.map((d) => ({
            id: d.name,
            name: d.modelName || d.name,
            provider: 'azure-ai-foundry',
          }));
          this.logger.info({
            models: this.discoveredModels.map(m => m.id),
            count: this.discoveredModels.length,
          }, '[AIF] Auto-discovered deployed models from Azure ARM');

          // Persist to DB so the chat selector (which reads from DB) has fresh data
          this.persistDiscoveredModelsToDb(deployments).catch((e: any) =>
            this.logger.warn({ error: e.message }, '[AIF] Failed to persist models to DB (non-fatal)')
          );
        } else {
          this.logger.info('[AIF] No deployments discovered via ARM — using configured model only');
        }
      } catch (err: any) {
        this.logger.warn({ error: err.message }, '[AIF] ARM model auto-discovery failed');
      }

      // Re-discover every 5 minutes so new AIF deployments appear automatically
      setInterval(() => { this.refreshModels().catch(() => {}); }, 5 * 60_000);
    }
  }

  /** Re-discover Azure deployments via ARM and sync to both in-memory + DB every 5 min */
  private async refreshModels(): Promise<void> {
    if (!this.endpointUrl || (!this.apiKey && !this.useEntraAuth && !this.useDefaultAzureCredential)) return;
    try {
      const deployments = await this.listDeploymentsViaARM();
      if (deployments.length > 0) {
        const found = deployments.map((d) => ({
          id: d.name,
          name: d.modelName || d.name,
          provider: 'azure-ai-foundry',
        }));
        const oldIds = new Set(this.discoveredModels.map(m => m.id));
        const newIds = new Set(found.map(m => m.id));
        const added = [...newIds].filter(id => !oldIds.has(id));
        const removed = [...oldIds].filter(id => !newIds.has(id));
        if (added.length > 0 || removed.length > 0) {
          this.logger.info({ added, removed, total: found.length }, '[AIF] Deployment changes detected — syncing to DB');
          // Persist changes to DB so chat selector picks them up immediately
          this.persistDiscoveredModelsToDb(deployments).catch(() => {});
        }
        this.discoveredModels = found;
      }
    } catch { /* silent — will retry in 5 minutes */ }
  }

  /**
   * List AIF deployments via Azure ARM management API.
   * This is the only reliable way to enumerate deployments on CognitiveServices
   * accounts — the /openai/deployments inference endpoint returns 404 on AIF.
   */
  private async listDeploymentsViaARM(): Promise<Array<{
    name: string;
    modelName: string;
    modelVersion: string;
    status: string;
    sku: string;
    capacity: number;
  }>> {
    if (!this.useEntraAuth || !this.tenantId || !this.clientId || !this.clientSecret) {
      // API key auth can't call ARM — fall back to empty
      this.logger.debug('[AIF] ARM discovery requires Entra credentials — skipping');
      return [];
    }

    // Extract account name from endpoint URL (e.g., "openagentic-ai-foundry-eus2" from
    // "https://openagentic-ai-foundry-eus2.cognitiveservices.azure.com")
    const hostname = new URL(this.endpointUrl).hostname;
    const accountName = hostname.split('.')[0];

    // Get ARM management token (different scope from cognitiveservices)
    const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
    const tokenResp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'https://management.azure.com/.default',
      }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!tokenResp.ok) {
      throw new Error(`ARM token failed: ${tokenResp.status}`);
    }
    const tokenData = await tokenResp.json() as any;
    const armToken = tokenData.access_token;

    // Find the CognitiveServices account across all subscriptions
    // GET /subscriptions?api-version=2022-12-01 → then search for the account
    const subsResp = await fetch('https://management.azure.com/subscriptions?api-version=2022-12-01', {
      headers: { Authorization: `Bearer ${armToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!subsResp.ok) throw new Error(`List subscriptions failed: ${subsResp.status}`);
    const subsData = await subsResp.json() as any;
    const subscriptions = (subsData.value || []).map((s: any) => s.subscriptionId);

    // Search each subscription for the account
    for (const subId of subscriptions) {
      const accountsUrl = `https://management.azure.com/subscriptions/${subId}/providers/Microsoft.CognitiveServices/accounts?api-version=2024-10-01`;
      const acctResp = await fetch(accountsUrl, {
        headers: { Authorization: `Bearer ${armToken}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!acctResp.ok) continue;
      const acctData = await acctResp.json() as any;
      const account = (acctData.value || []).find((a: any) =>
        a.name === accountName || a.properties?.endpoint?.includes(accountName)
      );
      if (!account) continue;

      // Found it — extract resourceGroup from the ID
      // Format: /subscriptions/{sub}/resourceGroups/{rg}/providers/Microsoft.CognitiveServices/accounts/{name}
      const rgMatch = account.id?.match(/resourceGroups\/([^/]+)/i);
      const rg = rgMatch?.[1];
      if (!rg) continue;

      // List deployments
      const deplUrl = `https://management.azure.com/subscriptions/${subId}/resourceGroups/${rg}/providers/Microsoft.CognitiveServices/accounts/${accountName}/deployments?api-version=2024-10-01`;
      const deplResp = await fetch(deplUrl, {
        headers: { Authorization: `Bearer ${armToken}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!deplResp.ok) {
        this.logger.warn({ status: deplResp.status }, '[AIF] ARM deployments list failed');
        return [];
      }
      const deplData = await deplResp.json() as any;
      const deployments = (deplData.value || [])
        .filter((d: any) => d.properties?.provisioningState === 'Succeeded')
        .map((d: any) => ({
          name: d.name,
          modelName: d.properties?.model?.name || d.name,
          modelVersion: d.properties?.model?.version || '',
          status: d.properties?.provisioningState || 'Unknown',
          sku: d.sku?.name || '',
          capacity: d.sku?.capacity || 0,
        }));

      this.logger.info({
        subscription: subId, resourceGroup: rg, accountName,
        deploymentCount: deployments.length,
        deployments: deployments.map((d: any) => `${d.name} (${d.modelName})`),
      }, '[AIF] ARM deployment discovery complete');

      return deployments;
    }

    this.logger.warn({ accountName }, '[AIF] Could not find CognitiveServices account in any subscription');
    return [];
  }

  /**
   * Ensure an Azure AIF deployment exists for the given model (ARM PUT).
   *
   * Admin-console add-model path: when an operator registers a model via
   * /api/admin/llm-providers/:id/models, we create the backing Azure
   * deployment so the subsequent ARM-discovery sync finds it and doesn't
   * prune the DB row. Idempotent — returns early if deployment already
   * exists.
   *
   * Returns the deployment name on success; throws on hard error.
   */
  async ensureArmDeployment(params: {
    deploymentName: string;
    modelName: string;
    modelVersion: string;
    modelFormat?: string;
    sku: string;
    capacity: number;
  }): Promise<{ created: boolean; deploymentName: string }> {
    if (!this.useEntraAuth || !this.tenantId || !this.clientId || !this.clientSecret) {
      throw new Error('[AIF] ensureArmDeployment requires Entra credentials on provider');
    }
    const accountName = new URL(this.endpointUrl).hostname.split('.')[0];
    const armTokenResp = await fetch(
      `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          scope: 'https://management.azure.com/.default',
        }).toString(),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!armTokenResp.ok) {
      throw new Error(`[AIF] ARM token failed: ${armTokenResp.status}`);
    }
    const armToken = ((await armTokenResp.json()) as any).access_token as string;

    // Locate the subscription + resource group.
    const subsResp = await fetch(
      'https://management.azure.com/subscriptions?api-version=2022-12-01',
      { headers: { Authorization: `Bearer ${armToken}` }, signal: AbortSignal.timeout(10_000) },
    );
    if (!subsResp.ok) throw new Error(`[AIF] list subscriptions failed: ${subsResp.status}`);
    const subs = ((await subsResp.json()) as any).value as any[];

    let subId: string | null = null;
    let rg: string | null = null;
    for (const s of subs) {
      const acctsUrl = `https://management.azure.com/subscriptions/${s.subscriptionId}/providers/Microsoft.CognitiveServices/accounts?api-version=2024-10-01`;
      const acctsResp = await fetch(acctsUrl, {
        headers: { Authorization: `Bearer ${armToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!acctsResp.ok) continue;
      const accts = ((await acctsResp.json()) as any).value as any[];
      const acct = accts.find(
        a => a.name === accountName || a.properties?.endpoint?.includes(accountName),
      );
      if (!acct) continue;
      const m = acct.id?.match(/resourceGroups\/([^/]+)/i);
      if (!m) continue;
      subId = s.subscriptionId;
      rg = m[1];
      break;
    }
    if (!subId || !rg) {
      throw new Error(`[AIF] could not locate CognitiveServices account ${accountName}`);
    }

    // Check if the deployment already exists.
    const deplUrl = `https://management.azure.com/subscriptions/${subId}/resourceGroups/${rg}/providers/Microsoft.CognitiveServices/accounts/${accountName}/deployments/${encodeURIComponent(params.deploymentName)}?api-version=2024-10-01`;
    const headResp = await fetch(deplUrl, {
      headers: { Authorization: `Bearer ${armToken}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (headResp.ok) {
      this.logger.info(
        { deployment: params.deploymentName, accountName },
        '[AIF] ensureArmDeployment: already exists',
      );
      return { created: false, deploymentName: params.deploymentName };
    }

    // PUT the deployment.
    const putBody = {
      sku: { name: params.sku, capacity: params.capacity },
      properties: {
        model: {
          format: params.modelFormat || 'OpenAI',
          name: params.modelName,
          version: params.modelVersion,
        },
      },
    };
    const putResp = await fetch(deplUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${armToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(putBody),
      signal: AbortSignal.timeout(60_000),
    });
    if (!putResp.ok) {
      const errText = await putResp.text().catch(() => '');
      throw new Error(
        `[AIF] deployment PUT failed ${putResp.status}: ${errText.slice(0, 300)}`,
      );
    }
    this.logger.info(
      {
        deployment: params.deploymentName,
        model: params.modelName,
        version: params.modelVersion,
        sku: params.sku,
        capacity: params.capacity,
        accountName,
      },
      '[AIF] ensureArmDeployment: created',
    );
    return { created: true, deploymentName: params.deploymentName };
  }

  /**
   * Persist ARM-discovered AIF deployments into the Registry SoT
   * (admin.model_role_assignments). This is what makes "deploy a model in
   * Azure → it appears in the registry" work without admin clicks.
   *
   * Previously this also wrote to provider_config.models[] (the legacy
   * store). That field is being deleted — every consumer should read
   * the Registry. The lastDiscoveryAt timestamp is preserved on the
   * llm_providers row for observability only.
   */
  private async persistDiscoveredModelsToDb(deployments: Array<{ name: string; modelName: string; modelVersion: string; sku: string; capacity: number }>): Promise<void> {
    const { prisma } = await import('../../utils/prisma.js');
    const { upsertDiscoveredModels } = await import('../model-routing/RegistryUpsertService.js');

    // Find our provider row to get its `name` (the join key in the Registry's
    // `provider` column) + `created_by` for new Registry inserts.
    const hostname = new URL(this.endpointUrl).hostname;
    const accountName = hostname.split('.')[0];
    const provider = await prisma.lLMProvider.findFirst({
      where: {
        provider_type: 'azure-ai-foundry',
        deleted_at: null,
        OR: [
          { provider_config: { path: ['endpoint'], string_contains: accountName } },
          { provider_config: { path: ['endpointUrl'], string_contains: accountName } },
          { auth_config: { path: ['endpoint'], string_contains: accountName } },
          { auth_config: { path: ['endpointUrl'], string_contains: accountName } },
        ],
      },
    });
    if (!provider) {
      this.logger.warn({ accountName }, '[AIF] persistDiscoveredModelsToDb: provider row not found — Registry rows will not be auto-created until next restart');
      return;
    }

    // Map ARM deployment shape → DiscoveredModel shape consumed by the Registry upserter.
    const discovered = deployments.map(d => {
      const ml = (d.modelName || d.name).toLowerCase();
      return {
        id: d.name,
        name: d.modelName || d.name,
        provider: 'azure-ai-foundry',
        description: `Deployed — ${d.sku}, capacity ${d.capacity}`,
        family: this.inferFamily(ml),
        costTier: this.inferCostTier(ml),
        capabilities: this.inferCapabilities(ml),
        contextWindow: this.inferContextWindow(ml),
        maxOutputTokens: this.inferMaxOutput(ml),
        configured: true,
        deployed: true,
      } as any;
    });

    try {
      const result = await upsertDiscoveredModels(
        {
          providerName: provider.name,
          discovered,
          createdBy: provider.created_by ?? '00000000-0000-0000-0000-000000000000',
          providerType: 'azure-ai-foundry',
          region: null,
        },
        prisma as any,
      );
      this.logger.info(
        { provider: provider.name, deployments: discovered.length, inserted: result.inserted, updated: result.updated },
        '[AIF] Synced ARM deployments into Registry (admin.model_role_assignments)',
      );
    } catch (err: any) {
      this.logger.warn({ error: err.message }, '[AIF] Registry upsert failed — deployments not persisted');
    }

    // Stamp lastDiscoveryAt on the provider row for ops visibility (no models[] write).
    try {
      const existingConfig = (provider.provider_config as any) || {};
      const { models: _legacyModels, ...rest } = existingConfig;
      await prisma.lLMProvider.update({
        where: { id: provider.id },
        data: { provider_config: { ...rest, lastDiscoveryAt: new Date().toISOString() } },
      });
    } catch { /* best-effort timestamp; not fatal */ }
  }

  /**
   * Get Azure AD access token for Entra ID authentication
   */
  private async getEntraToken(): Promise<string> {
    // Check cache first
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }

    if (!this.tenantId || !this.clientId || !this.clientSecret) {
      throw new Error('Entra ID credentials not configured');
    }

    try {
      const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
      const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'https://cognitiveservices.azure.com/.default'
      });

      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to get Entra token: ${response.status} ${errorText}`);
      }

      const data = await response.json();

      // Cache token (expires_in is in seconds, cache for 5 minutes before expiry)
      const expiresAt = Date.now() + (data.expires_in - 300) * 1000;
      this.tokenCache = { token: data.access_token, expiresAt };

      this.logger.debug('[AzureAIFoundryProvider] Entra ID token obtained and cached');
      return data.access_token;

    } catch (error) {
      this.logger.error({ error }, '[AzureAIFoundryProvider] Failed to get Entra token');
      throw error;
    }
  }

  /**
   * Get an Azure AD access token via DefaultAzureCredential (ambient az login,
   * mounted ~/.azure). Used when neither an API key nor an Entra app is set.
   */
  private async getDefaultAzureCredentialToken(): Promise<string> {
    if (!this.defaultAzureCredential) {
      throw new Error('DefaultAzureCredential not configured');
    }
    // Reuse the same 5-min-before-expiry cache as the Entra path.
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }
    const tokenResponse = await this.defaultAzureCredential.getToken(
      'https://cognitiveservices.azure.com/.default'
    );
    if (!tokenResponse?.token) {
      throw new Error('DefaultAzureCredential returned no token (is ~/.azure / az login available?)');
    }
    const expiresAt = (tokenResponse.expiresOnTimestamp || (Date.now() + 3600_000)) - 300_000;
    this.tokenCache = { token: tokenResponse.token, expiresAt };
    this.logger.debug('[AzureAIFoundryProvider] DefaultAzureCredential token obtained and cached');
    return tokenResponse.token;
  }

  /**
   * Get authentication headers (API key, Entra ID bearer token, or ambient
   * DefaultAzureCredential bearer token)
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.useEntraAuth) {
      // Use Entra ID (Azure AD) authentication
      const token = await this.getEntraToken();
      headers['Authorization'] = `Bearer ${token}`;
    } else if (this.useDefaultAzureCredential) {
      // Ambient az login (mounted ~/.azure) via DefaultAzureCredential
      const token = await this.getDefaultAzureCredentialToken();
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      // Use API key authentication
      headers['api-key'] = this.apiKey;
    }

    return headers;
  }

  async listModels(): Promise<Array<{ id: string; name: string; provider: string }>> {
    // Return auto-discovered models from Azure deployments API (populated during initialize)
    if (this.discoveredModels.length > 0) {
      return this.discoveredModels;
    }

    // Fallback: return the single configured model
    if (this.model) {
      return [{ id: this.model, name: this.model, provider: 'azure-ai-foundry' }];
    }

    return [];
  }

  /**
   * Convert OpenAI messages format to Anthropic Messages API format
   */
  private convertToAnthropicMessages(messages: CompletionRequest['messages']): {
    system?: string;
    messages: any[];
  } {
    let system: string | undefined;
    const anthropicMessages: any[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        // Anthropic uses a separate system parameter
        system = msg.content;
      } else if (msg.role === 'tool') {
        // Tool result message
        anthropicMessages.push({
          role: 'user',
          content: [{
            type: 'tool_result',
            tool_use_id: msg.tool_call_id,
            content: msg.content
          }]
        });
      } else if (msg.role === 'assistant' && msg.tool_calls) {
        // Assistant message with tool calls
        const content: any[] = [];

        // Add text content if present
        if (msg.content) {
          content.push({
            type: 'text',
            text: msg.content
          });
        }

        // Add tool use blocks
        for (const toolCall of msg.tool_calls) {
          content.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments)
          });
        }

        anthropicMessages.push({
          role: 'assistant',
          content
        });
      } else {
        // Regular user or assistant message
        // Skip messages with empty content (Anthropic requires non-empty content)
        if (msg.content && msg.content.trim()) {
          anthropicMessages.push({
            role: msg.role,
            content: msg.content
          });
        }
      }
    }

    return { system, messages: anthropicMessages };
  }

  /**
   * Convert OpenAI tools format to Anthropic tools format
   */
  private convertToAnthropicTools(tools: any[] | undefined): any[] | undefined {
    if (!tools || tools.length === 0) return undefined;

    // Accept BOTH OpenAI shape `{type, function:{name, parameters}}`
    // and Anthropic-native shape `{name, input_schema}`. The /v1/messages
    // route hands us OpenAI-shaped (we converted it ourselves), but if a
    // caller passes already-Anthropic tools we should accept them too.
    const out = tools
      .map((tool) => {
        const name = tool.function?.name || tool.name;
        const description = tool.function?.description || tool.description || '';
        const input_schema = tool.function?.parameters || tool.input_schema || { type: 'object', properties: {} };
        if (!name) return null;
        return { name, description, input_schema };
      })
      .filter((t): t is { name: string; description: string; input_schema: any } => t !== null);

    this.logger.info({
      inCount: tools.length,
      outCount: out.length,
      firstShape: tools[0] ? Object.keys(tools[0]).join(',') : 'empty',
      firstName: tools[0]?.function?.name || tools[0]?.name,
    }, '[AIF] convertToAnthropicTools');

    return out.length > 0 ? out : undefined;
  }

  /**
   * Convert Anthropic response to OpenAI format
   */
  private convertAnthropicResponseToOpenAI(anthropicResponse: any, modelName: string): CompletionResponse {
    const toolCalls: any[] = [];
    let textContent = '';
    let reasoningContent = '';

    // Extract content blocks
    for (const block of anthropicResponse.content || []) {
      if (block.type === 'text') {
        textContent += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input)
          }
        });
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        // #656 — surface Anthropic-shape thinking blocks. Mirrors the
        // Bedrock #647 Layer 2 fix; the streaming path already emits
        // these as thinking_delta (line ~1742-1753) but the non-stream
        // converter dropped them.
        reasoningContent += block.thinking;
      }
    }

    const message: any = {
      role: 'assistant',
      content: textContent
    };

    if (reasoningContent) {
      message.reasoning_content = reasoningContent;
    }

    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }

    return {
      id: anthropicResponse.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelName,
      choices: [{
        index: 0,
        message,
        finish_reason: anthropicResponse.stop_reason === 'end_turn' ? 'stop' :
                      anthropicResponse.stop_reason === 'tool_use' ? 'tool_calls' :
                      anthropicResponse.stop_reason || 'stop'
      }],
      usage: {
        prompt_tokens: anthropicResponse.usage?.input_tokens || 0,
        completion_tokens: anthropicResponse.usage?.output_tokens || 0,
        total_tokens: (anthropicResponse.usage?.input_tokens || 0) + (anthropicResponse.usage?.output_tokens || 0)
      }
    };
  }

    private parseDeepSeekToolCalls(content: string): {
    toolCalls: any[];
    cleanedContent: string;
    hasDeepSeekMarkers: boolean;
  } {
    // DeepSeek tool call markers (Unicode full-width characters)
    const MARKERS = {
      toolCallsBegin: '<｜tool▁calls▁begin｜>',
      toolCallsEnd: '<｜tool▁calls▁end｜>',
      toolCallBegin: '<｜tool▁call▁begin｜>',
      toolCallEnd: '<｜tool▁call▁end｜>',
      toolSep: '<｜tool▁sep｜>'
    };

    // Check if content contains DeepSeek markers
    const hasDeepSeekMarkers = content.includes(MARKERS.toolCallsBegin) ||
                                content.includes(MARKERS.toolCallBegin);

    if (!hasDeepSeekMarkers) {
      return { toolCalls: [], cleanedContent: content, hasDeepSeekMarkers: false };
    }

    this.logger.info('[AzureAIFoundryProvider] Detected DeepSeek tool call markers - parsing');

    const toolCalls: any[] = [];
    let cleanedContent = content;

    try {
      // Extract the entire tool calls block
      const toolCallsPattern = new RegExp(
        `${MARKERS.toolCallsBegin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\S]*?)${MARKERS.toolCallsEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        'g'
      );

      const toolCallsMatches = content.matchAll(toolCallsPattern);

      for (const match of toolCallsMatches) {
        const toolCallsBlock = match[1];

        // Extract individual tool calls from the block
        const toolCallPattern = new RegExp(
          `${MARKERS.toolCallBegin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\S]*?)${MARKERS.toolCallEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
          'g'
        );

        const toolCallMatches = toolCallsBlock.matchAll(toolCallPattern);

        for (const toolCallMatch of toolCallMatches) {
          const toolCallContent = toolCallMatch[1];

          // Split by separator to get name and arguments
          const parts = toolCallContent.split(MARKERS.toolSep);

          if (parts.length >= 2) {
            const toolName = parts[0].trim();
            const toolArgsJson = parts[1].trim();

            try {
              // Parse the JSON arguments
              const toolArgs = JSON.parse(toolArgsJson);

              // Generate a unique ID for this tool call
              const toolCallId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

              // Convert to OpenAI tool_calls format
              toolCalls.push({
                id: toolCallId,
                type: 'function',
                function: {
                  name: toolName,
                  arguments: toolArgsJson
                }
              });

              this.logger.info({
                toolName,
                toolCallId,
                argsLength: toolArgsJson.length
              }, '[AzureAIFoundryProvider] Parsed DeepSeek tool call');

            } catch (parseError) {
              this.logger.warn({
                error: parseError,
                toolCallContent
              }, '[AzureAIFoundryProvider] Failed to parse DeepSeek tool call JSON');
            }
          }
        }

        // Remove the entire tool calls block from content
        cleanedContent = cleanedContent.replace(match[0], '');
      }

      // Clean up any remaining markers that might be left over
      Object.values(MARKERS).forEach(marker => {
        cleanedContent = cleanedContent.replace(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
      });

      // Trim whitespace
      cleanedContent = cleanedContent.trim();

      this.logger.info({
        toolCallsFound: toolCalls.length,
        originalLength: content.length,
        cleanedLength: cleanedContent.length
      }, '[AzureAIFoundryProvider] DeepSeek tool calls parsed successfully');

    } catch (error) {
      this.logger.error({
        error
      }, '[AzureAIFoundryProvider] Error parsing DeepSeek tool calls');
    }

    return { toolCalls, cleanedContent, hasDeepSeekMarkers: true };
  }

  /**
   * Convert Anthropic streaming chunk to OpenAI format
   */
  private convertAnthropicStreamChunkToOpenAI(event: any, modelName: string): any {
    if (event.type === 'message_start') {
      return {
        id: event.message.id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{
          index: 0,
          delta: { role: 'assistant', content: '' },
          finish_reason: null
        }]
      };
    } else if (event.type === 'content_block_start' && event.content_block?.type === 'text') {
      return {
        id: 'chunk',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{
          index: 0,
          delta: { content: '' },
          finish_reason: null
        }]
      };
    } else if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
      return {
        id: 'chunk',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{
          index: 0,
          delta: { content: event.delta.text },
          finish_reason: null
        }]
      };
    } else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      return {
        id: 'chunk',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              id: event.content_block.id,
              type: 'function',
              function: {
                name: event.content_block.name,
                arguments: ''
              }
            }]
          },
          finish_reason: null
        }]
      };
    } else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
      return {
        id: 'chunk',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: 0,
              function: {
                arguments: event.delta.partial_json
              }
            }]
          },
          finish_reason: null
        }]
      };
    } else if (event.type === 'message_delta') {
      return {
        id: 'chunk',
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: event.delta?.stop_reason === 'end_turn' ? 'stop' :
                        event.delta?.stop_reason === 'tool_use' ? 'tool_calls' :
                        event.delta?.stop_reason || null
        }],
        usage: event.usage ? {
          prompt_tokens: event.usage.input_tokens || 0,
          completion_tokens: event.usage.output_tokens || 0,
          total_tokens: (event.usage.input_tokens || 0) + (event.usage.output_tokens || 0)
        } : undefined
      };
    }

    return null;
  }

  /**
   * Get the endpoint URL
   *
   * NOTE: We always use the model-router endpoint because that's the only deployment
   * that exists in Azure AI Foundry. The model-router internally routes to different
   * models based on the 'model' field in the request body.
   *
   * DO NOT try to change the deployment name in the URL - there are no separate
   * deployments for gpt-5, gpt-5-mini, etc. They are all accessed through model-router.
   * The model selection happens via the 'model' field in the request JSON body.
   */
  private getEndpointUrl(modelForDeployment?: string): string {
    // (#71) UNIFIED ENDPOINT MODE — use the Foundry catalog inference API
    // at {base}/models/chat/completions. The model name goes in the request
    // body, not the URL. This works for partner-catalog models (Claude,
    // Mistral, Llama, etc.) without per-model deployments — only requires a
    // one-time marketplace subscription accept in Azure portal.
    //
    // For Azure OpenAI native models (GPT-5, o-series), this endpoint
    // typically does NOT work — those still require explicit deployments.
    // Admin should leave useUnifiedEndpoint=false for AOAI models.
    if (this.useUnifiedEndpoint) {
      // If endpoint already contains the unified path, use as-is
      if (this.endpointUrl.includes('/models/chat/completions')) {
        return this.endpointUrl;
      }
      const base = this.endpointUrl
        .replace(/\/openai.*$/, '')
        .replace(/\/anthropic.*$/, '')
        .replace(/\/$/, '');
      const url = `${base}/models/chat/completions?api-version=${this.apiVersion}`;
      this.logger.debug({ base, apiVersion: this.apiVersion, url, mode: 'unified' }, '[AzureAIFoundryProvider] Built unified endpoint URL');
      return url;
    }

    // PER-DEPLOYMENT MODE (legacy/default) — required for Azure OpenAI models.
    // If endpoint already contains /chat/completions or /openai/, use as-is
    if (this.endpointUrl.includes('/chat/completions') || this.endpointUrl.includes('/openai/')) {
      return this.endpointUrl;
    }

    const requestModel = modelForDeployment || this.model;
    const base = this.endpointUrl.replace(/\/$/, '');

    // Anthropic models (Claude) on AIF use a different API endpoint AND hostname.
    // CognitiveServices (*.cognitiveservices.azure.com) → rewrite to AI Services (*.services.ai.azure.com)
    // Then use /anthropic/v1/messages instead of /openai/deployments/.../chat/completions
    const ml = (requestModel || '').toLowerCase();
    if (ml.includes('claude')) {
      // AIServices endpoint uses services.ai.azure.com, not cognitiveservices.azure.com
      const aiServicesBase = base
        .replace('.cognitiveservices.azure.com', '.services.ai.azure.com')
        .replace('.openai.azure.com', '.services.ai.azure.com');
      const url = `${aiServicesBase}/anthropic/v1/messages`;
      this.logger.debug({ base: aiServicesBase, model: requestModel, url, mode: 'anthropic' }, '[AzureAIFoundryProvider] Built Anthropic endpoint URL');
      return url;
    }

    // OpenAI-format models: standard deployment URL
    // Format: {endpoint}/openai/deployments/{deployment}/chat/completions?api-version={version}
    const deploymentName = this.resolveDeploymentName(requestModel);
    const url = `${base}/openai/deployments/${deploymentName}/chat/completions?api-version=${this.apiVersion}`;
    this.logger.debug({ base, deploymentName, apiVersion: this.apiVersion, url, mode: 'per-deployment' }, '[AzureAIFoundryProvider] Built endpoint URL');
    return url;
  }

  /**
   * Resolve a model name to its Azure deployment name.
   * Uses AIF_DEPLOYMENT_MAP env var for explicit mappings, otherwise
   * sanitizes the model name (removes dots/special chars) as a fallback.
   */
  private resolveDeploymentName(model: string): string {
    // If the model name matches the configured deployment, use it directly
    // This prevents stale env vars from overriding DB-configured deployment names
    if (model === this.model) {
      return model; // DB config is source of truth
    }

    // Check explicit deployment map for OTHER models
    const mapStr = process.env.AIF_DEPLOYMENT_MAP || '';
    if (mapStr) {
      for (const entry of mapStr.split(',')) {
        const [modelName, deployName] = entry.split('=').map(s => s.trim());
        if (modelName && deployName && model.toLowerCase() === modelName.toLowerCase()) {
          return deployName;
        }
      }
    }
    // Fallback: if AIF_MODEL env is set and matches the default model, use it as deployment name
    if (process.env.AIF_MODEL && (model === this.model || model === process.env.AIF_CHAT_MODEL)) {
      return process.env.AIF_MODEL;
    }
    // Last resort: use model name as-is (works for deployments named after the model)
    return model;
  }

  /**
   * Detect if a model uses max_completion_tokens instead of max_tokens
   * Based on environment configuration or version parsing (NO HARDCODED MODELS)
   */
  private modelUsesMaxCompletionTokens(model: string): boolean {
    const modelLower = model.toLowerCase();

    // o-series reasoning models ALWAYS use max_completion_tokens
    if (modelLower.includes('o1') || modelLower.includes('o3') || modelLower.includes('o4')) {
      return true;
    }

    // Check if model is in env-configured list
    const maxCompletionTokensModels = (process.env.MAX_COMPLETION_TOKENS_MODELS || '').split(',').map(m => m.trim().toLowerCase());
    if (maxCompletionTokensModels.some(m => m && modelLower.includes(m))) {
      return true;
    }

    // GPT-4.1+ and GPT-5+ use max_completion_tokens
    const gptMatch = modelLower.match(/gpt-?(\d+)\.?(\d*)/);
    if (gptMatch) {
      const major = Number.parseInt(gptMatch[1]);
      const minor = Number.parseInt(gptMatch[2] || '0');
      if (major >= 5 || (major === 4 && minor >= 1)) {
        return true;
      }
    }

    return false;
  }

    private selectModel(request: CompletionRequest): { model: string; reason: string } {
    const hasTools = request.tools && request.tools.length > 0;
    const toolCount = request.tools?.length || 0;
    const isComplexFunctionCalling = toolCount > 3; // More than 3 tools = complex

    // If preferSpecificModel is enabled and request has tools, use dedicated function calling model
    if (this.preferSpecificModel && hasTools) {
      return {
        model: this.functionCallingModel,
        reason: `Function calling detected (${toolCount} tools) - using dedicated model for 96.7% accuracy`
      };
    }

    // If complex function calling (many tools), always use specific model
    if (isComplexFunctionCalling) {
      return {
        model: this.functionCallingModel,
        reason: `Complex function calling (${toolCount} tools) - using ${this.functionCallingModel} for best results`
      };
    }

    // Use model-router for simple queries or when specific model not preferred
    const requestedModel = request.model || this.model;
    return {
      model: requestedModel,
      reason: hasTools
        ? `Simple function calling (${toolCount} tools) - using ${requestedModel}`
        : `No tools - using ${requestedModel} for cost optimization`
    };
  }

  /**
   * Create chat completion (supports both OpenAI and Anthropic formats)
   */
  async createCompletion(request: CompletionRequest): Promise<CompletionResponse | AsyncGenerator<any>> {
    const startTime = Date.now();

    try {
      this.metrics.totalRequests++;

      // Route to appropriate implementation based on API format.
      // Dynamic per-request: Claude models use Anthropic Messages API even if
      // the provider endpoint is configured for OpenAI format. This allows a
      // single AIF provider to serve both GPT-5 and Claude deployments.
      const modelName = (request.model || this.model || '').toLowerCase();
      const useAnthropicForThisRequest = this.isAnthropicFormat || modelName.includes('claude');
      if (useAnthropicForThisRequest && !this.isAnthropicFormat) {
        // Dynamic Claude-via-AIF path: bypass Anthropic SDK, use raw fetch to
        // services.ai.azure.com/anthropic/v1/messages with Entra bearer token.
        // The SDK doesn't work with the AIF endpoint (wrong auth format).
        return await this.createAIFAnthropicCompletion(request, startTime);
      } else if (useAnthropicForThisRequest) {
        return await this.createAnthropicCompletion(request, startTime);
      } else {
        return await this.createOpenAICompletion(request, startTime);
      }
    } catch (error) {
      this.trackFailure();
      this.logger.error({ error }, '[AzureAIFoundryProvider] Completion failed');
      throw error;
    }
  }

  /**
   * Create chat completion using Anthropic Messages API
   */
  private async createAnthropicCompletion(
    request: CompletionRequest,
    startTime: number
  ): Promise<CompletionResponse | AsyncGenerator<any>> {
    if (!this.anthropicClient) {
      throw new Error('Anthropic client not initialized');
    }

    // Anthropic doesn't support "model-router" - use configured Claude model instead
    let modelToUse = request.model || this.model;
    if (modelToUse === 'model-router' || modelToUse.includes('router')) {
      modelToUse = this.model === 'model-router' ? (process.env.AIF_ANTHROPIC_MODEL || process.env.DEFAULT_MODEL) : this.model;
      this.logger.debug({
        requestedModel: request.model,
        actualModel: modelToUse
      }, '[AzureAIFoundryProvider] Overriding model-router for Anthropic API');
    }

    // Phase 0.4 (2026-05-12) — SDK adapter is SoT for the Anthropic
    // Messages wire shape on AIF. Same helper as direct Anthropic +
    // Bedrock-Claude (proven via REAL round-trip tests).
    const anthropicDefaultTemp = Number.parseFloat(process.env.AIF_TEMPERATURE || '1.0');
    const anthropicRequest = buildAnthropicWireBody(
      {
        ...request,
        temperature: request.temperature ?? anthropicDefaultTemp,
      },
      {
        model: modelToUse,
        parallelOn: true,
      },
    ) as any;

    this.logger.info({
      model: anthropicRequest.model,
      messageCount: anthropicRequest.messages?.length ?? 0,
      toolCount: anthropicRequest.tools?.length ?? 0,
      hasSystem: !!anthropicRequest.system,
      stream: request.stream,
      maxTokens: anthropicRequest.max_tokens,
    }, '[AzureAIFoundryProvider] Creating Anthropic completion');

    // AIF Anthropic streaming has event-format issues with the completion stage,
    // so it stays off by default and non-streaming handles every request. It can
    // be opted into via AIF_ANTHROPIC_STREAMING=true once the stream format is fixed.
    const aifAnthropicStreamingEnabled = process.env.AIF_ANTHROPIC_STREAMING === 'true';
    if (aifAnthropicStreamingEnabled && request.stream) {
      return this.streamAnthropicCompletion(anthropicRequest, startTime);
    } else {
      return await this.nonStreamAnthropicCompletion(anthropicRequest, startTime);
    }
  }

  /**
   * Create chat completion using OpenAI-compatible API
   */
  /**
   * Claude via AIF using raw fetch to services.ai.azure.com/anthropic/v1/messages.
   * Bypasses the Anthropic Foundry SDK which doesn't work with AIF's auth.
   */
  private async createAIFAnthropicCompletion(
    request: CompletionRequest,
    startTime: number
  ): Promise<CompletionResponse | AsyncGenerator<any>> {
    const base = this.endpointUrl
      .replace(/\/openai.*$/, '').replace(/\/anthropic.*$/, '').replace(/\/$/, '')
      .replace('.cognitiveservices.azure.com', '.services.ai.azure.com')
      .replace('.openai.azure.com', '.services.ai.azure.com');
    const url = `${base}/anthropic/v1/messages`;

    // Get Entra token (or ambient DefaultAzureCredential token)
    const token = this.useEntraAuth
      ? await this.getEntraToken()
      : this.useDefaultAzureCredential
        ? await this.getDefaultAzureCredentialToken()
        : null;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else if (this.apiKey) {
      headers['api-key'] = this.apiKey;
    }

    // Phase 0.4 — SDK adapter is SoT for the Anthropic Messages wire
    // shape. Same `OpenagenticToAnthropic` class proven via REAL Bedrock
    // round-trip; AIF accepts identical body shape on /anthropic/v1/messages.
    const modelToUse = request.model || this.model;
    const body = buildAnthropicWireBody(
      {
        ...request,
        // Anthropic requires temperature=1 for thinking models.
        temperature: request.temperature ?? 1,
      },
      {
        model: modelToUse,
        parallelOn: true,
      },
    ) as any;
    // Preserve stream flag on body (AIF's /anthropic/v1/messages reads
    // body.stream, unlike Bedrock which uses InvokeModelWithResponseStream).
    if (request.stream !== undefined) body.stream = request.stream;

    this.logger.info({
      url,
      model: modelToUse,
      stream: body.stream,
      messageCount: body.messages?.length ?? 0,
      toolCount: body.tools?.length ?? 0,
    }, '[AIF-Anthropic] Raw fetch to services.ai.azure.com');

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.requestTimeout),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`AIF Anthropic ${response.status}: ${errText.substring(0, 200)}`);
    }

    if (!body.stream) {
      // Non-streaming: convert Anthropic response to OpenAI format
      const data = await response.json() as any;
      return this.convertAnthropicResponseToOpenAI(data, modelToUse);
    }

    // Streaming: yield converted chunks
    return this.streamAIFAnthropicResponse(response, modelToUse, startTime);
  }

  private async *streamAIFAnthropicResponse(
    response: Response,
    modelName: string,
    startTime: number
  ): AsyncGenerator<any> {
    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');
    const decoder = new TextDecoder();
    let buffer = '';
    let blockIndex = 0;

    // Yield initial role chunk in OpenAI format (same as Bedrock line 746)
    yield {
      id: `aif-anthropic-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: modelName,
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }]
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]' || !data) continue;

          try {
            const event = JSON.parse(data);
            // Yield Anthropic-native events — same format Bedrock uses.
            // The completion stage already handles these.
            if (event.type === 'content_block_start') {
              blockIndex = event.index ?? blockIndex;
              if (event.content_block?.type === 'tool_use') {
                yield { type: 'content_block_start', index: blockIndex, content_block: { type: 'tool_use', id: event.content_block.id, name: event.content_block.name } };
              } else if (event.content_block?.type === 'thinking') {
                yield { type: 'content_block_start', index: blockIndex, content_block: { type: 'thinking' } };
              } else {
                yield { type: 'content_block_start', index: blockIndex, content_block: { type: 'text', text: '' } };
              }
            } else if (event.type === 'content_block_delta') {
              if (event.delta?.type === 'text_delta') {
                yield { type: 'content_block_delta', index: event.index ?? blockIndex, delta: { type: 'text_delta', text: event.delta.text } };
              } else if (event.delta?.type === 'input_json_delta') {
                yield { type: 'content_block_delta', index: event.index ?? blockIndex, delta: { type: 'input_json_delta', partial_json: event.delta.partial_json } };
              } else if (event.delta?.type === 'thinking_delta') {
                yield { type: 'content_block_delta', index: event.index ?? blockIndex, delta: { type: 'thinking_delta', thinking: event.delta.thinking } };
              }
            } else if (event.type === 'content_block_stop') {
              yield { type: 'content_block_stop', index: event.index ?? blockIndex };
            } else if (event.type === 'message_delta') {
              const usage = event.usage || {};
              yield {
                type: 'message_delta',
                delta: { stop_reason: event.delta?.stop_reason },
                usage: { input_tokens: usage.input_tokens || 0, output_tokens: usage.output_tokens || 0 }
              };
              this.trackSuccess(Date.now() - startTime, (usage.input_tokens || 0) + (usage.output_tokens || 0), 0);
            } else if (event.type === 'message_stop') {
              yield { type: 'message_stop' };
            }
            // Skip: message_start, ping
          } catch { /* skip unparseable */ }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private async createOpenAICompletion(
    request: CompletionRequest,
    startTime: number
  ): Promise<CompletionResponse | AsyncGenerator<any>> {
    // Use the model from the request (set by pipeline/user), or fall back to configured default.
    // NO internal model override — the pipeline decides the model, just like Bedrock/Vertex.
    const selectedModel = request.model || this.model;
    const reason = `Using ${selectedModel} (from ${request.model ? 'pipeline request' : 'provider default'})`;

    // Phase 0.4 (2026-05-12) — SDK adapter is SoT for wire shape.
    // buildAifChatCompletionsBody handles:
    //   - Anthropic → OpenAI message conversion (via completionRequestToCanonical)
    //   - parallel tool_use folding into single assistant.tool_calls[] (Sev-0 #774)
    //   - tool_result orphan filter
    //   - GPT-5.x temperature strip, o-series top_p strip
    //   - max_completion_tokens vs max_tokens model-family gate
    //   - normalizeAifToolParameters on every tool's JSON Schema
    //   - reasoning_effort pass-through
    //   - stream_options { include_usage: true } on streaming only
    const defaultTemperature = Number.parseFloat(process.env.AIF_TEMPERATURE || '1.0');
    const aifRequest = buildAifChatCompletionsBody(request, {
      model: selectedModel,
      defaultTemperature,
    });

    this.logger.info({
      requestedModel: request.model,
      selectedModel,
      selectionReason: reason,
      messageCount: request.messages.length,
      toolCount: request.tools?.length || 0,
      preferSpecificModel: this.preferSpecificModel,
      stream: request.stream,
      endpoint: this.endpointUrl.includes('model-router') ? 'model-router (WARNING: ignores model field)' : 'direct'
    }, '[AzureAIFoundryProvider] Creating OpenAI completion');

    // Warn if using model-router with tools - model-router may select a less capable model
    if (this.endpointUrl.includes('model-router') && request.tools && request.tools.length > 0) {
      this.logger.warn({
        selectedModel,
        toolCount: request.tools.length,
        note: 'model-router may select gpt-5-nano which has ~65% function calling accuracy'
      }, '[AzureAIFoundryProvider] ⚠️ Using model-router with tools - consider separate deployments for reliable function calling');
    }

    if (request.stream) {
      return this.streamCompletion(aifRequest, selectedModel, startTime);
    } else {
      return await this.nonStreamCompletion(aifRequest, selectedModel, startTime);
    }
  }

  /**
   * Stream Anthropic completion (returns AsyncGenerator)
   */
  private async *streamAnthropicCompletion(
    anthropicRequest: any,
    startTime: number
  ): AsyncGenerator<any> {
    if (!this.anthropicClient) {
      throw new Error('Anthropic client not initialized');
    }

    try {
      const streamParams: any = {
        model: anthropicRequest.model,
        messages: anthropicRequest.messages,
        max_tokens: anthropicRequest.max_tokens,
        temperature: anthropicRequest.temperature
      };

      // Only add optional params if they exist
      if (anthropicRequest.system) streamParams.system = anthropicRequest.system;
      if (anthropicRequest.tools) streamParams.tools = anthropicRequest.tools;
      if (anthropicRequest.tool_choice) streamParams.tool_choice = anthropicRequest.tool_choice;

      const stream = this.anthropicClient.messages.stream(streamParams);

      let totalTokens = 0;
      const modelName = anthropicRequest.model;

      for await (const event of stream) {
        const chunk = this.convertAnthropicStreamChunkToOpenAI(event, modelName);
        if (chunk) {
          yield chunk;

          // Track tokens from usage events
          if (chunk.usage) {
            totalTokens = chunk.usage.total_tokens || 0;
          }

          // Check if done
          if (chunk.choices?.[0]?.finish_reason) {
            const latency = Date.now() - startTime;
            this.trackSuccess(latency, totalTokens, 0);

            this.logger.info({
              model: modelName,
              duration: latency,
              totalTokens
            }, '[AzureAIFoundryProvider] Anthropic stream completed');
          }
        }
      }
    } catch (error) {
      this.trackFailure();
      this.logger.error({ error }, '[AzureAIFoundryProvider] Anthropic stream failed');
      throw error;
    }
  }

  /**
   * Non-streaming Anthropic completion
   */
  private async nonStreamAnthropicCompletion(
    anthropicRequest: any,
    startTime: number
  ): Promise<CompletionResponse> {
    if (!this.anthropicClient) {
      throw new Error('Anthropic client not initialized');
    }

    try {
      const response = await this.anthropicClient.messages.create({
        ...anthropicRequest,
        stream: false
      });

      const totalTokens = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
      const latency = Date.now() - startTime;
      this.trackSuccess(latency, totalTokens, 0);

      this.logger.info({
        model: anthropicRequest.model,
        duration: latency,
        totalTokens
      }, '[AzureAIFoundryProvider] Anthropic completion completed');

      return this.convertAnthropicResponseToOpenAI(response, anthropicRequest.model);
    } catch (error) {
      this.trackFailure();
      this.logger.error({ error }, '[AzureAIFoundryProvider] Anthropic non-stream completion failed');
      throw error;
    }
  }

  /**
   * Stream completion (returns AsyncGenerator)
   */
  private async *streamCompletion(
    aifRequest: any,
    modelName: string,
    startTime: number
  ): AsyncGenerator<any> {
    // Dispatch to Responses API branch for deployments that reject chat/completions.
    // Safe fall-through: any non-matching model continues on the existing path.
    if (this.shouldUseResponsesApi(modelName)) {
      this.logger.info(
        { deployment: modelName, model: modelName, reason: 'responses-api-required' },
        '[AzureAIFoundryProvider] Routing to /openai/v1/responses (preview) — chat/completions unsupported for this deployment'
      );
      yield* this.streamResponsesApi(aifRequest, modelName, startTime);
      return;
    }

    try {
      const headers = await this.getAuthHeaders();
      const endpointUrl = this.getEndpointUrl(modelName);
      this.logger.info({
        endpointUrl,
        hasAuth: !!headers['Authorization'] || !!headers['api-key'],
        authType: headers['Authorization'] ? 'bearer' : headers['api-key'] ? 'api-key' : 'none',
        model: modelName,
        apiVersion: this.apiVersion,
      }, '[AzureAIFoundryProvider] Stream request URL');
      const response = await fetchWithRetry(endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(aifRequest)
      }, { logger: this.logger });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AIF API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body from AIF');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let totalTokens = 0;
      let accumulatedContent = ''; // Accumulate content to detect DeepSeek markers

      // INTERLEAVED THINKING: Track block indices for proper interleaving
      let blockIndex = 0;
      let currentBlockType: 'thinking' | 'text' | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          if (line.includes('[DONE]')) continue;

          try {
            const data = line.slice(6); // Remove 'data: ' prefix
            const chunk = JSON.parse(data);

            // Accumulate content from deltas to detect DeepSeek markers
            if (chunk.choices?.[0]?.delta?.content) {
              accumulatedContent += chunk.choices[0].delta.content;
            }

            // Extract reasoning content for o3-mini and other reasoning models
            // OpenAI returns reasoning in message.reasoning_content (non-streaming)
            // or delta.reasoning_content (streaming)
            const reasoningContent = chunk.choices?.[0]?.delta?.reasoning_content ||
                                     chunk.choices?.[0]?.message?.reasoning_content;

            if (reasoningContent) {
              // INTERLEAVED THINKING: Start a new thinking block if not already in one
              if (currentBlockType !== 'thinking') {
                // Close previous block if any
                if (currentBlockType !== null) {
                  yield {
                    type: 'content_block_stop',
                    index: blockIndex
                  };
                  blockIndex++;
                }

                // Start new thinking block
                yield {
                  type: 'content_block_start',
                  index: blockIndex,
                  content_block: { type: 'thinking' }
                };
                currentBlockType = 'thinking';
              }

              // Emit thinking delta with block index
              yield {
                type: 'content_block_delta',
                index: blockIndex,
                delta: {
                  type: 'thinking_delta',
                  thinking: reasoningContent
                }
              };

              // NOTE: Do NOT yield OpenAI-compatible format here.
              // Content is already emitted via content_block_* events above.
              // Yielding an additional chunk with delta.thinking would cause duplicate
              // thinking blocks in processProviderStream (processed by both Anthropic path
              // and OpenAI path).
              continue; // Don't yield any more chunks for this thinking content
            }

            // INTERLEAVED THINKING: Handle regular content
            const textContent = chunk.choices?.[0]?.delta?.content;
            if (textContent) {
              // Start a new text block if switching from thinking
              if (currentBlockType !== 'text') {
                // Close previous block if any
                if (currentBlockType !== null) {
                  yield {
                    type: 'content_block_stop',
                    index: blockIndex
                  };
                  blockIndex++;
                }

                // Start new text block
                yield {
                  type: 'content_block_start',
                  index: blockIndex,
                  content_block: { type: 'text' }
                };
                currentBlockType = 'text';
              }

              // Emit text delta with block index
              yield {
                type: 'content_block_delta',
                index: blockIndex,
                delta: {
                  type: 'text_delta',
                  text: textContent
                }
              };

              // NOTE: Do NOT yield the original OpenAI chunk when we've already
              // emitted content_block_* events. The pipeline's processProviderStream
              // handles both Anthropic and OpenAI paths — yielding both formats for the
              // same content causes every token to render twice in the UI.
              // Only yield the original chunk for finish_reason handling below.
              if (!chunk.choices?.[0]?.finish_reason) {
                // Track tokens from intermediate chunks
                if (chunk.usage) {
                  totalTokens = chunk.usage.total_tokens || 0;
                  // Yield usage-only chunk so completion stage can capture token counts
                  yield chunk;
                }
                continue;
              }
            }

            // Check if we have a complete message (finish_reason present)
            if (chunk.choices?.[0]?.finish_reason) {
              // INTERLEAVED THINKING: Close the final block
              if (currentBlockType !== null) {
                yield {
                  type: 'content_block_stop',
                  index: blockIndex
                };
              }

              // Parse DeepSeek tool calls if present
              const { toolCalls, cleanedContent, hasDeepSeekMarkers } =
                this.parseDeepSeekToolCalls(accumulatedContent);

              if (hasDeepSeekMarkers) {
                // Create a corrected chunk with parsed tool calls
                const correctedChunk = {
                  ...chunk,
                  choices: [{
                    ...chunk.choices[0],
                    delta: {
                      content: cleanedContent,
                      tool_calls: toolCalls.length > 0 ? toolCalls : undefined
                    },
                    finish_reason: toolCalls.length > 0 ? 'tool_calls' : chunk.choices[0].finish_reason
                  }]
                };

                yield correctedChunk;
              } else {
                yield chunk;
              }

              // Track tokens — only set if this finish_reason chunk also
              // happens to carry usage (rare; AIF normally puts usage on a
              // separate trailing chunk, see else-branch below).
              if (chunk.usage) {
                totalTokens = chunk.usage.total_tokens || 0;
              }

              // Note: do NOT log "Stream completed" here — when
              // stream_options.include_usage:true is set, AIF emits a
              // trailing chunk AFTER finish_reason with the populated
              // usage block. Logging here means totalTokens=0 even when
              // the model returned tokens correctly. The completion log
              // fires once at end-of-stream below.
            } else {
              // Not done yet, yield the chunk as-is
              yield chunk;

              // Track tokens — captures the trailing usage chunk that
              // arrives AFTER finish_reason when stream_options.include_usage
              // is enabled. Real shape per dev-environment capture 2026-05-10:
              // {choices:[], usage:{prompt_tokens, completion_tokens, total_tokens}}.
              if (chunk.usage) {
                totalTokens = chunk.usage.total_tokens || 0;
              }
            }
          } catch (parseError) {
            this.logger.warn({ line, error: parseError }, '[AzureAIFoundryProvider] Failed to parse chunk');
          }
        }
      }

      // End-of-stream — log AFTER the reader exhausted (so the trailing
      // include_usage chunk has been consumed and totalTokens reflects
      // the authoritative count). Mirrors `Completion completed` for the
      // non-stream branch.
      const finalLatency = Date.now() - startTime;
      this.trackSuccess(finalLatency, totalTokens, 0);
      this.logger.info({
        model: modelName,
        duration: finalLatency,
        totalTokens,
      }, '[AzureAIFoundryProvider] Stream completed');

    } catch (error) {
      this.trackFailure();
      this.logger.error({ error }, '[AzureAIFoundryProvider] Stream failed');
      throw error;
    }
  }

  /**
   * Gate: should this deployment/model be dispatched to the Responses API
   * instead of chat/completions? Azure AOAI's gpt-5-codex family, gpt-5-pro,
   * o1-pro and o3-pro return 400 "unsupported" on /chat/completions.
   *
   * Checks both the raw id passed in AND the discovered deployment's
   * underlying modelName (ARM discovery result) in case the deployment
   * has been renamed. Any uncertainty falls back to chat/completions.
   */
  private shouldUseResponsesApi(modelOrDeployment: string): boolean {
    if (!modelOrDeployment) return false;

    const candidates = new Set<string>();
    const raw = modelOrDeployment.trim();
    candidates.add(raw);
    // Strip trailing -<version> / _<version> suffixes (e.g. "gpt-5-pro-2025-10-06")
    candidates.add(raw.replace(/[-_](?:v?\d[\w.-]*)$/i, ''));

    // Cross-reference discovered deployments so a deployment aliased to
    // "codex-prod" still gates on its underlying modelName.
    for (const m of this.discoveredModels) {
      if (m.id === raw || m.name === raw) {
        candidates.add(m.id);
        candidates.add(m.name);
      }
    }

    for (const c of candidates) {
      if (c && RESPONSES_API_REQUIRED_PATTERN.test(c)) return true;
    }
    return false;
  }

  /**
   * Build the Responses-API endpoint URL. Always uses `api-version=preview`
   * per Azure docs — the stable surface does not yet cover the Responses API.
   */
  private getResponsesApiEndpointUrl(): string {
    const base = this.endpointUrl
      .replace(/\/openai.*$/, '')
      .replace(/\/anthropic.*$/, '')
      .replace(/\/$/, '');
    return `${base}/openai/v1/responses?api-version=preview`;
  }

  /**
   * @deprecated Phase 0.4 (audit §0.4) — wire-shape translation moved to the
   * SDK adapter at `@agentic-work/llm-sdk/lib/adapters` via the thin helper
   * `buildAifResponsesBody`. This method is kept temporarily for the admin
   * "Test provider" probe at internal call sites that haven't migrated yet;
   * the two streaming/non-streaming call paths inside this class use the
   * SDK helper. To be deleted once arch test
   * `outbound-adapter-wire-in-per-provider.source-regression.test.ts`
   * proves no in-class callers remain.
   *
   * Original docstring:
   * Translate an internal OpenAI-chat-style messages array (system/user/
   * assistant, optional tool_result content parts) into the Responses API
   * `input` array, and hoist the system prompt into top-level `instructions`.
   */
  private buildResponsesApiBody(aifRequest: {
    model: string;
    messages: Array<{ role: string; content: unknown; tool_call_id?: string; tool_calls?: unknown }>;
    tools?: unknown;
    max_tokens?: number;
    max_completion_tokens?: number;
    reasoning_effort?: string;
  }, deployment: string): Record<string, unknown> {
    let instructions: string | undefined;
    const input: Array<Record<string, unknown>> = [];

    for (const msg of aifRequest.messages || []) {
      if (msg.role === 'system') {
        const txt = typeof msg.content === 'string'
          ? msg.content
          : Array.isArray(msg.content)
            ? (msg.content as Array<{ text?: string }>).map((p) => p?.text || '').join('')
            : '';
        instructions = instructions ? `${instructions}\n\n${txt}` : txt;
        continue;
      }

      if (msg.role === 'tool') {
        // OpenAI-style tool result → Responses function_call_output item.
        // Azure 400s on empty call_id, so skip rather than send invalid.
        if (!msg.tool_call_id) continue;
        const output = typeof msg.content === 'string'
          ? msg.content
          : JSON.stringify(msg.content ?? '');
        input.push({
          type: 'function_call_output',
          call_id: msg.tool_call_id,
          output,
        });
        continue;
      }

      const partType = msg.role === 'assistant' ? 'output_text' : 'input_text';
      let textParts: Array<{ type: string; text: string }> = [];

      // Sev-0 #774 fix — when convertAnthropicMessagesToOpenAI folded
      // tool_use blocks into `msg.tool_calls[]` on the assistant message,
      // `msg.content` is now the string (or empty), and the array branch
      // below never sees the tool_use blocks. Without replaying these as
      // `function_call` items the next turn's `function_call_output`
      // entries get dropped as orphans (line ~2497 guard) and the model
      // sees an empty tool result history → "I don't have those results".
      // Replay tool_calls[] BEFORE the textParts so call_id pairing stays
      // intact with the function_call_output items that follow.
      if (
        msg.role === 'assistant' &&
        Array.isArray((msg as { tool_calls?: unknown }).tool_calls)
      ) {
        const tcs = (msg as { tool_calls: Array<{
          id?: string;
          function?: { name?: string; arguments?: string | object };
        }> }).tool_calls;
        for (const tc of tcs) {
          const callId = typeof tc.id === 'string' ? tc.id : '';
          if (!callId) continue;
          const argsStr = typeof tc.function?.arguments === 'string'
            ? tc.function.arguments
            : JSON.stringify(tc.function?.arguments ?? {});
          input.push({
            type: 'function_call',
            call_id: callId,
            name: tc.function?.name || '',
            arguments: argsStr,
          });
        }
      }

      if (typeof msg.content === 'string') {
        textParts = [{ type: partType, text: msg.content }];
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content as Array<{ type?: string; text?: string; input?: unknown; id?: string; name?: string }>) {
          if (part?.type === 'text' && typeof part.text === 'string') {
            textParts.push({ type: partType, text: part.text });
          } else if (part?.type === 'tool_use' && msg.role === 'assistant') {
            // Replay of a prior assistant tool call. Azure Responses API
            // rejects empty/missing call_id with "empty_string". Skip the
            // replay entry rather than 400 the whole turn — the model will
            // still see the prior text context.
            const callId = typeof part.id === 'string' ? part.id : '';
            if (!callId) continue;
            input.push({
              type: 'function_call',
              call_id: callId,
              name: part.name || '',
              arguments: typeof part.input === 'string' ? part.input : JSON.stringify(part.input ?? {}),
            });
          } else if (part?.type === 'tool_result') {
            const callId = typeof (part as { tool_use_id?: string }).tool_use_id === 'string'
              ? (part as { tool_use_id?: string }).tool_use_id!
              : '';
            if (!callId) continue;
            input.push({
              type: 'function_call_output',
              call_id: callId,
              output: typeof part.text === 'string' ? part.text : JSON.stringify(part ?? ''),
            });
          }
        }
      }

      if (textParts.length > 0) {
        input.push({ role: msg.role, content: textParts });
      }
    }

    // Defense-in-depth (2026-04-26): AIF Responses API 400s with
    //   "No tool call found for function call output with call_id call_X"
    // when a function_call_output references a call_id that has no
    // matching function_call in the same `input` array. This can happen
    // when:
    //   - the assistant tool_use block had an empty/missing id (we
    //     skipped it at line ~2018) but its tool_result still got pushed
    //   - the daemon's resumed history dropped the tool_use turn but
    //     kept the tool_result
    //
    // TWO-PASS so the filter is order-independent. The first pass
    // collects every function_call call_id anywhere in `input`. The
    // second pass drops function_call_output items whose call_id wasn't
    // seen — including the case where the function_call appears AFTER
    // the output in iteration order.
    //
    // Single-pass version (2026-04-26 first attempt) also dropped valid
    // outputs when the upstream conversion happened to emit the
    // function_call after its function_call_output, which then made
    // gpt-5.3-codex stream `response.failed` because every assistant
    // turn lost its tool result and the model had nothing to act on
    // ("plan mode forever, nothing happens").
    const allFunctionCallIds = new Set<string>();
    for (const item of input) {
      if (
        (item as { type?: string }).type === 'function_call' &&
        typeof (item as { call_id?: string }).call_id === 'string' &&
        ((item as { call_id?: string }).call_id as string).length > 0
      ) {
        allFunctionCallIds.add((item as { call_id?: string }).call_id as string);
      }
    }
    const filteredInput: Array<Record<string, unknown>> = [];
    let droppedOrphans = 0;
    for (const item of input) {
      const itemType = (item as { type?: string }).type;
      const callId = (item as { call_id?: string }).call_id;
      if (itemType === 'function_call_output') {
        if (typeof callId === 'string' && allFunctionCallIds.has(callId)) {
          filteredInput.push(item);
        } else {
          droppedOrphans++;
        }
      } else {
        filteredInput.push(item);
      }
    }
    if (droppedOrphans > 0) {
      this.logger?.warn?.(
        { droppedOrphans, deployment },
        '[AzureAIFoundryProvider] dropped orphan function_call_output items (no matching function_call)',
      );
    }

    const body: Record<string, unknown> = {
      model: deployment,
      stream: true,
      input: filteredInput,
      max_output_tokens: aifRequest.max_completion_tokens ?? aifRequest.max_tokens ?? 32768,
    };
    if (instructions) body.instructions = instructions;

    // Translate upstream tool shape → Responses-API tool shape.
    // Upstream may pass OpenAI (`{type:'function', function:{name,description,parameters}}`)
    // or Anthropic (`{name, description, input_schema}`) — accept both. Responses API
    // wants the flat form: `{type:'function', name, description, parameters}`. Any tool
    // with no resolvable name is dropped (Azure rejects the whole request on a single
    // missing tools[N].name, which happened in the first rollout).
    if (Array.isArray(aifRequest.tools) && aifRequest.tools.length > 0) {
      // Azure Responses API requires every tool's `parameters` to be a valid
      // JSON Schema of type "object". MCP-discovered tools sometimes arrive
      // with parameters missing, null, a non-object value, or an object
      // without a `type` field — any of which trips
      //   "Invalid schema for function 'X': schema must be a JSON Schema
      //    of 'type: \"object\"', got 'type: \"None\"'."
      // and fails the entire request. Normalize to a well-formed object
      // schema before sending.
      // Azure Responses API requires every tool parameters schema to be a
      // strict object: type="object", no oneOf/anyOf/allOf/enum/not at the
      // top level, a properties map present. Use the shared helper so the
      // Chat Completions path (above) and Responses-API path (here) stay
      // in lockstep.
      const mapped = (aifRequest.tools as Array<any>).map((t) => {
        const name: string =
          (typeof t?.function?.name === 'string' && t.function.name) ||
          (typeof t?.name === 'string' && t.name) ||
          '';
        const description: string | undefined =
          t?.function?.description ?? t?.description ?? undefined;
        const rawParams: unknown =
          t?.function?.parameters ?? t?.parameters ?? t?.input_schema;
        const parameters = normalizeAifToolParameters(rawParams);
        if (!name) return null;
        return { type: 'function', name, description, parameters };
      }).filter(Boolean);
      if (mapped.length > 0) body.tools = mapped;
      this.logger.info({
        inCount: aifRequest.tools.length,
        outCount: mapped.length,
        firstIn: Object.keys(aifRequest.tools[0] || {}).join(','),
        firstFnKeys: aifRequest.tools[0] && (aifRequest.tools[0] as any).function
          ? Object.keys((aifRequest.tools[0] as any).function).join(',') : 'no-fn',
        firstSample: JSON.stringify(aifRequest.tools[0]).slice(0, 300),
        firstOut: mapped[0] ? (mapped[0] as any).name : null,
      }, '[AzureAIFoundryProvider] Responses API tool translation');
    }
    if (aifRequest.reasoning_effort) {
      body.reasoning = { effort: aifRequest.reasoning_effort };
    }
    return body;
  }

  /**
   * Responses-API streaming branch.
   *
   * WHY: Azure AIF deployments of codex/pro models require /openai/v1/responses
   * and emit a different SSE event schema. We translate those events back to
   * the same Anthropic Messages shape (message_start, content_block_start/
   * delta/stop, message_delta, message_stop) that the rest of the codebase —
   * especially routes/openagentic.ts — consumes from every other provider.
   *
   * Event mapping (Azure Responses → Anthropic):
   *   response.created / response.in_progress → message_start
   *   response.output_item.added (message)    → content_block_start (text)
   *   response.output_text.delta              → content_block_delta(text_delta)
   *   response.output_item.added (function)   → content_block_start (tool_use)
   *   response.function_call_arguments.delta  → content_block_delta(input_json_delta)
   *   response.output_item.done               → content_block_stop
   *   response.completed                      → message_delta + message_stop
   *   response.failed / response.incomplete   → throw
   */
  private async *streamResponsesApi(
    aifRequest: { model: string; messages: Array<{ role: string; content: unknown }>; tools?: unknown; max_tokens?: number; max_completion_tokens?: number; reasoning_effort?: string },
    deployment: string,
    startTime: number
  ): AsyncGenerator<any> {
    const endpointUrl = this.getResponsesApiEndpointUrl();
    const headers = await this.getAuthHeaders();
    // Phase 0.4 — SDK adapter is SoT for Responses API wire body.
    // Provider layers AIF-specific decoration (deployment, reasoning_effort,
    // max_output_tokens fallback chain).
    const body = buildAifResponsesBody(aifRequest as unknown as CompletionRequest, {
      deployment,
      stream: true,
      reasoningEffort: aifRequest.reasoning_effort,
      maxOutputTokensOverride: aifRequest.max_completion_tokens ?? aifRequest.max_tokens,
    });

    this.logger.info({
      endpointUrl,
      deployment,
      hasAuth: !!headers['Authorization'] || !!headers['api-key'],
      authType: headers['Authorization'] ? 'bearer' : headers['api-key'] ? 'api-key' : 'none',
    }, '[AzureAIFoundryProvider] Responses API stream request');

    let response: Response;
    try {
      // 2026-05-11 fix — route through fetchWithRetry to survive transient
      // Azure gateway 5xx (e.g. eastus2 "upstream connect error or
      // disconnect/reset before headers" 503 captured during capstone
      // synthesis turn). The non-streaming Responses API path and the
      // legacy Chat Completions path already use this helper; the
      // streaming path was the missing one.
      response = await fetchWithRetry(endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      }, { logger: this.logger });
    } catch (err) {
      this.trackFailure();
      this.logger.error({ err, deployment, endpointUrl }, '[AzureAIFoundryProvider] Responses API fetch error');
      throw err;
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      this.trackFailure();
      this.logger.error({
        status: response.status,
        statusText: response.statusText,
        body: errorText.slice(0, 500),
        deployment,
        modelName: deployment,
      }, '[AzureAIFoundryProvider] Responses API non-OK response');
      throw new Error(`AIF Responses API error: ${response.status} ${response.statusText} - ${errorText}`);
    }
    if (!response.body) {
      this.trackFailure();
      throw new Error('No response body from AIF Responses API');
    }

    // Track which output_index → Anthropic block index + block kind so we
    // can translate output_item.done into the right content_block_stop.
    type BlockInfo = { index: number; kind: 'text' | 'tool_use' };
    const outputIndexToBlock = new Map<number, BlockInfo>();
    let nextBlockIndex = 0;
    let messageStarted = false;
    let inputTokens = 0;
    let outputTokens = 0;
    // 2026-05-10 fix — track function_call presence DURING streaming.
    // AIF's `response.completed` event does not reliably populate
    // `r.output` with function_call items in time for the stop_reason
    // decision, so we set this flag when output_item.added arrives with
    // `itemType === 'function_call'`. Without this, function-calling turns
    // were mapped to stop_reason='end_turn' and chatLoop exited the turn
    // before dispatching the tool (live wire capture proved the regression).
    let hadFunctionCall = false;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const mapStopReason = (finish: string | undefined | null): 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' => {
      switch ((finish || '').toLowerCase()) {
        case 'tool_calls':
        case 'function_call':
          return 'tool_use';
        case 'length':
        case 'max_output_tokens':
        case 'max_tokens':
          return 'max_tokens';
        case 'stop_sequence':
          return 'stop_sequence';
        default:
          return 'end_turn';
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;

          let evt: Record<string, any>;
          try {
            evt = JSON.parse(payload);
          } catch (e) {
            this.logger.warn({ line, err: e }, '[AzureAIFoundryProvider] Failed to parse Responses SSE line');
            continue;
          }

          const type: string = evt.type || '';

          if (type === 'response.created' || type === 'response.in_progress') {
            if (!messageStarted) {
              messageStarted = true;
              const r = evt.response || {};
              yield {
                type: 'message_start',
                message: {
                  id: r.id || `resp_${Date.now()}`,
                  model: r.model || deployment,
                  role: 'assistant',
                  content: [],
                  stop_reason: null,
                  usage: { input_tokens: 0, output_tokens: 0 },
                },
              };
            }
            continue;
          }

          if (type === 'response.output_item.added') {
            const item = evt.item || {};
            const outputIndex: number = typeof evt.output_index === 'number' ? evt.output_index : nextBlockIndex;
            const itemType: string = item.type || '';
            if (itemType === 'message') {
              const info: BlockInfo = { index: nextBlockIndex++, kind: 'text' };
              outputIndexToBlock.set(outputIndex, info);
              yield {
                type: 'content_block_start',
                index: info.index,
                content_block: { type: 'text', text: '' },
              };
            } else if (itemType === 'function_call') {
              hadFunctionCall = true;
              const info: BlockInfo = { index: nextBlockIndex++, kind: 'tool_use' };
              outputIndexToBlock.set(outputIndex, info);
              yield {
                type: 'content_block_start',
                index: info.index,
                content_block: {
                  type: 'tool_use',
                  id: item.call_id || item.id || `call_${info.index}`,
                  name: item.name || '',
                  input: {},
                },
              };
            }
            // Other item types (reasoning, etc.) are ignored for now — they
            // don't map to Anthropic content blocks the consumers expect.
            continue;
          }

          if (type === 'response.output_text.delta') {
            const outputIndex: number = typeof evt.output_index === 'number' ? evt.output_index : 0;
            const info = outputIndexToBlock.get(outputIndex);
            const delta: string = typeof evt.delta === 'string' ? evt.delta : '';
            if (info && info.kind === 'text' && delta) {
              yield {
                type: 'content_block_delta',
                index: info.index,
                delta: { type: 'text_delta', text: delta },
              };
            }
            continue;
          }

          if (type === 'response.function_call_arguments.delta') {
            const outputIndex: number = typeof evt.output_index === 'number' ? evt.output_index : 0;
            const info = outputIndexToBlock.get(outputIndex);
            const partial: string = typeof evt.delta === 'string' ? evt.delta : '';
            if (info && info.kind === 'tool_use' && partial) {
              yield {
                type: 'content_block_delta',
                index: info.index,
                delta: { type: 'input_json_delta', partial_json: partial },
              };
            }
            continue;
          }

          if (type === 'response.output_item.done') {
            const outputIndex: number = typeof evt.output_index === 'number' ? evt.output_index : 0;
            const info = outputIndexToBlock.get(outputIndex);
            if (info) {
              yield { type: 'content_block_stop', index: info.index };
              outputIndexToBlock.delete(outputIndex);
            }
            continue;
          }

          if (type === 'response.completed') {
            const r = evt.response || {};
            const usage = r.usage || {};
            inputTokens = usage.input_tokens ?? usage.prompt_tokens ?? 0;
            outputTokens = usage.output_tokens ?? usage.completion_tokens ?? 0;
            // Flush any blocks still open (defensive — the server normally
            // emits output_item.done first).
            for (const info of outputIndexToBlock.values()) {
              yield { type: 'content_block_stop', index: info.index };
            }
            outputIndexToBlock.clear();

            const finishReason: string = r.incomplete_details?.reason || r.stop_reason || r.status || '';
            // 2026-05-10 fix — prefer the in-stream `hadFunctionCall` flag.
            // AIF's `response.completed` often arrives with an empty (or
            // partial) `r.output` array, so inspecting it for function_call
            // items is unreliable. We already saw the function_call item
            // during streaming (output_item.added → set the flag), which is
            // the authoritative signal. Falling back to r.output inspection
            // is kept as a belt-and-suspenders for the rare case the
            // streaming event was somehow missed but the final payload is
            // populated.
            const rOutputHasFunctionCall =
              Array.isArray(r.output) &&
              (r.output as Array<{ type?: string }>).some((o) => o?.type === 'function_call');
            const stopReason = mapStopReason(
              hadFunctionCall || rOutputHasFunctionCall ? 'tool_calls' : finishReason,
            );
            yield {
              type: 'message_delta',
              delta: { stop_reason: stopReason, stop_sequence: null },
              usage: { input_tokens: inputTokens, output_tokens: outputTokens },
            };
            yield { type: 'message_stop' };

            const latency = Date.now() - startTime;
            this.trackSuccess(latency, inputTokens + outputTokens, 0);
            this.logger.info({
              deployment,
              duration: latency,
              inputTokens,
              outputTokens,
            }, '[AzureAIFoundryProvider] Responses API stream completed');
            continue;
          }

          if (type === 'response.failed' || type === 'response.incomplete') {
            const r = evt.response || {};
            const errMsg = r.error?.message || r.incomplete_details?.reason || type;
            this.trackFailure();
            this.logger.error({
              deployment,
              modelName: deployment,
              status: type,
              body: JSON.stringify(evt).slice(0, 500),
            }, '[AzureAIFoundryProvider] Responses API stream reported failure');
            throw new Error(`AIF Responses API stream ${type}: ${errMsg}`);
          }
        }
      }
    } catch (error) {
      this.trackFailure();
      this.logger.error({ error, deployment }, '[AzureAIFoundryProvider] Responses API stream error');
      throw error;
    }
  }

  /**
   * Responses-API non-streaming branch.
   *
   * Mirror of streamResponsesApi for callers that pass `stream: false` —
   * notably the admin "Test provider" probe at
   * POST /api/admin/llm-providers/:name/test, which previously 400'd on
   * codex/pro/o-pro deployments because nonStreamCompletion always hit
   * /chat/completions.
   *
   * Translates the Responses API JSON response shape (output[] of message /
   * function_call items, usage.input_tokens/output_tokens) back into the
   * OpenAI chat-completions CompletionResponse shape so callers don't need
   * to branch on which underlying API was used.
   */
  private async nonStreamResponsesApi(
    aifRequest: { model: string; messages: Array<{ role: string; content: unknown }>; tools?: unknown; max_tokens?: number; max_completion_tokens?: number; reasoning_effort?: string },
    deployment: string,
    startTime: number
  ): Promise<CompletionResponse> {
    const endpointUrl = this.getResponsesApiEndpointUrl();
    const headers = await this.getAuthHeaders();
    // Phase 0.4 — see streamResponsesApi for the SoT pattern. stream:false for
    // the synchronous admin "Test provider" probe path.
    const body = buildAifResponsesBody(aifRequest as unknown as CompletionRequest, {
      deployment,
      stream: false,
      reasoningEffort: aifRequest.reasoning_effort,
      maxOutputTokensOverride: aifRequest.max_completion_tokens ?? aifRequest.max_tokens,
    });

    let response: Response;
    try {
      response = await fetch(endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (err) {
      this.trackFailure();
      this.logger.error({ err, deployment, endpointUrl }, '[AzureAIFoundryProvider] Responses API non-stream fetch error');
      throw err;
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      this.trackFailure();
      this.logger.error({
        status: response.status,
        statusText: response.statusText,
        body: errorText.slice(0, 500),
        deployment,
      }, '[AzureAIFoundryProvider] Responses API non-stream non-OK response');
      throw new Error(`AIF Responses API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json() as {
      id?: string;
      model?: string;
      output?: Array<{
        type?: string;
        role?: string;
        call_id?: string;
        id?: string;
        name?: string;
        arguments?: string;
        content?: Array<{ type?: string; text?: string }>;
      }>;
      output_text?: string;
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
    };

    // Collect text and tool_calls from output[].
    let textContent = '';
    const toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];

    for (const item of data.output ?? []) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const part of item.content) {
          if ((part.type === 'output_text' || part.type === 'text') && typeof part.text === 'string') {
            textContent += part.text;
          }
        }
      } else if (item.type === 'function_call') {
        toolCalls.push({
          id: item.call_id || item.id || `call_${toolCalls.length}`,
          type: 'function',
          function: {
            name: item.name || '',
            arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {}),
          },
        });
      }
    }

    // Fallback: if no message item but output_text shorthand is present, use that.
    if (!textContent && typeof data.output_text === 'string') {
      textContent = data.output_text;
    }

    const promptTokens = data.usage?.input_tokens ?? 0;
    const completionTokens = data.usage?.output_tokens ?? 0;
    const totalTokens = data.usage?.total_tokens ?? promptTokens + completionTokens;
    const latency = Date.now() - startTime;
    this.trackSuccess(latency, totalTokens, 0);

    this.logger.info({
      model: deployment,
      duration: latency,
      totalTokens,
      hasText: !!textContent,
      toolCallCount: toolCalls.length,
    }, '[AzureAIFoundryProvider] Responses API non-stream completed');

    const message: { role: 'assistant'; content: string; tool_calls?: typeof toolCalls } = {
      role: 'assistant',
      content: textContent,
    };
    if (toolCalls.length > 0) message.tool_calls = toolCalls;

    return {
      id: data.id ?? `resp_${Date.now()}`,
      object: 'chat.completion',
      model: data.model ?? deployment,
      choices: [
        {
          index: 0,
          message,
          finish_reason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: totalTokens,
      },
    } as unknown as CompletionResponse;
  }

  /**
   * Non-streaming completion
   */
  private async nonStreamCompletion(
    aifRequest: any,
    modelName: string,
    startTime: number
  ): Promise<CompletionResponse> {
    // Codex/pro/o-pro deployments reject /chat/completions with
    // 400 "The requested operation is unsupported." — they require the
    // Responses API. Mirror the streamCompletion() branch so the admin
    // "Test provider" probe (which calls createCompletion with stream:false)
    // works for those deployments instead of always 400'ing.
    if (this.shouldUseResponsesApi(modelName)) {
      this.logger.info(
        { deployment: modelName, model: modelName, reason: 'responses-api-required' },
        '[AzureAIFoundryProvider] Routing non-stream call to /openai/v1/responses (preview) — chat/completions unsupported for this deployment'
      );
      return this.nonStreamResponsesApi(aifRequest, modelName, startTime);
    }

    try {
      const headers = await this.getAuthHeaders();
      const endpointUrl = this.getEndpointUrl(modelName);
      const response = await fetchWithRetry(endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...aifRequest, stream: false })
      }, { logger: this.logger });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AIF API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();

      // Check for DeepSeek markers in the response content
      if (data.choices?.[0]?.message?.content) {
        const { toolCalls, cleanedContent, hasDeepSeekMarkers } =
          this.parseDeepSeekToolCalls(data.choices[0].message.content);

        if (hasDeepSeekMarkers) {
          // Update the response with parsed tool calls and cleaned content
          data.choices[0].message.content = cleanedContent;

          if (toolCalls.length > 0) {
            data.choices[0].message.tool_calls = toolCalls;
            data.choices[0].finish_reason = 'tool_calls';
          }

          this.logger.info({
            model: modelName,
            toolCallsFound: toolCalls.length
          }, '[AzureAIFoundryProvider] DeepSeek markers detected and parsed in non-streaming response');
        }
      }

      const totalTokens = data.usage?.total_tokens || 0;
      const latency = Date.now() - startTime;
      this.trackSuccess(latency, totalTokens, 0);

      this.logger.info({
        model: modelName,
        duration: latency,
        totalTokens
      }, '[AzureAIFoundryProvider] Completion completed');

      return data;
    } catch (error) {
      this.trackFailure();
      this.logger.error({ error }, '[AzureAIFoundryProvider] Non-stream completion failed');
      throw error;
    }
  }

  /**
   * Generate text embeddings using Azure OpenAI embedding API
   * Note: Azure AI Foundry doesn't have a dedicated embedding endpoint,
   * so we use the Azure OpenAI embedding service directly
   */
  async embedText(text: string | string[]): Promise<number[] | number[][]> {
    try {
      const input = Array.isArray(text) ? text : [text];

      // Get embedding configuration from environment
      const embeddingEndpoint = process.env.AZURE_OPENAI_EMBEDDING_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT;
      const embeddingModel = process.env.DEFAULT_EMBEDDING_DEPLOYMENT ||
                            process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT ||
                            process.env.EMBEDDING_MODEL;
      const apiVersion = process.env.AZURE_OPENAI_EMBEDDING_API_VERSION || '2024-10-21';

      if (!embeddingEndpoint) {
        throw new Error('Embedding endpoint not configured. Set AZURE_OPENAI_EMBEDDING_ENDPOINT or AZURE_OPENAI_ENDPOINT');
      }

      // Build the embeddings API URL
      // If AZURE_OPENAI_EMBEDDING_ENDPOINT already contains /embeddings, use it directly
      // Otherwise build the full URL from base endpoint + deployment
      let url: string;
      if (embeddingEndpoint.includes('/embeddings')) {
        // Full endpoint URL provided (e.g., https://xxx.cognitiveservices.azure.com/openai/deployments/text-embedding-3-large/embeddings?api-version=2024-10-21)
        url = embeddingEndpoint;
      } else {
        // Base endpoint provided, build full URL
        url = `${embeddingEndpoint}/openai/deployments/${embeddingModel}/embeddings?api-version=${apiVersion}`;
      }

      const headers = await this.getAuthHeaders();

      this.logger.info({
        model: embeddingModel,
        inputTexts: input.length,
        endpoint: embeddingEndpoint.replace(/https:\/\/([^.]+)/, 'https://***')
      }, '[AzureAIFoundryProvider] Generating embeddings via Azure OpenAI');

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Embedding API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const embeddings = data.data.map((item: any) => item.embedding);

      this.logger.info({
        model: embeddingModel,
        inputTexts: input.length,
        dimensions: embeddings[0]?.length
      }, '[AzureAIFoundryProvider] Embeddings generated successfully');

      return Array.isArray(text) ? embeddings : embeddings[0];

    } catch (error) {
      this.logger.error({
        error: error instanceof Error ? error.message : error
      }, '[AzureAIFoundryProvider] Embedding generation failed');
      throw error;
    }
  }

  /**
   * Health check
   */
  async getHealth(): Promise<ProviderHealth> {
    try {
      if (!this.endpointUrl) {
        return {
          status: 'not_initialized',
          provider: this.name,
          error: 'Missing endpoint URL',
          lastChecked: new Date()
        };
      }

      if (!this.useEntraAuth && !this.apiKey) {
        return {
          status: 'not_initialized',
          provider: this.name,
          error: 'Missing both API key and Entra ID credentials',
          lastChecked: new Date()
        };
      }

      // ARM auto-discovery is itself a complete liveness signal: it requires
      // a working Entra token + reachable ARM management plane + the AIF
      // resource to exist. If we've discovered ≥1 deployment recently,
      // AIF is healthy. Skip the chat-completion round-trip — it's wasteful
      // and gpt-5.x-codex / pro models 404 on /chat/completions because
      // they require /openai/v1/responses (#229). (#370)
      if (Array.isArray(this.discoveredModels) && this.discoveredModels.length > 0) {
        return {
          status: 'healthy',
          provider: this.name,
          endpoint: this.endpointUrl.replace(/https:\/\/([^.]+)/, 'https://***'),
          lastChecked: new Date()
        };
      }
      // Fallback to chat-completion probe when no deployments discovered yet.
      const probeModel = pickHealthProbeModel(this.discoveredModels, this.model);
      if (!probeModel) {
        return {
          status: 'not_initialized',
          provider: this.name,
          error: 'No deployment discovered yet (ARM auto-discovery still in progress)',
          lastChecked: new Date()
        };
      }
      // Use the appropriate API format
      if (this.isAnthropicFormat && this.anthropicClient) {
        // Anthropic Messages API health check
        try {
          await this.anthropicClient.messages.create({
            model: probeModel,
            messages: [{ role: 'user', content: 'test' }],
            max_tokens: 1
          });

          return {
            status: 'healthy',
            provider: this.name,
            endpoint: this.endpointUrl.replace(/https:\/\/([^.]+)/, 'https://***'),
            lastChecked: new Date()
          };
        } catch (error: any) {
          return {
            status: 'unhealthy',
            provider: this.name,
            endpoint: this.endpointUrl.replace(/https:\/\/([^.]+)/, 'https://***'),
            error: error.message || 'Anthropic API error',
            lastChecked: new Date()
          };
        }
      } else {
        // OpenAI-compatible API health check
        const headers = await this.getAuthHeaders();
        const healthUrl = this.getEndpointUrl();
        // o3/o1 models use max_completion_tokens, not max_tokens
        const isReasoningModel = probeModel.includes('o3') || probeModel.includes('o1');
        const tokenParam = isReasoningModel
          ? { max_completion_tokens: 5 }
          : { max_tokens: 1 };
        const response = await fetch(healthUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: probeModel,
            messages: [{ role: 'user', content: 'test' }],
            ...tokenParam,
            stream: false
          }),
          signal: AbortSignal.timeout(15000)
        });

        if (response.ok) {
          return {
            status: 'healthy',
            provider: this.name,
            endpoint: this.endpointUrl.replace(/https:\/\/([^.]+)/, 'https://***'),
            lastChecked: new Date()
          };
        } else {
          return {
            status: 'unhealthy',
            provider: this.name,
            endpoint: this.endpointUrl.replace(/https:\/\/([^.]+)/, 'https://***'),
            error: `HTTP ${response.status}`,
            lastChecked: new Date()
          };
        }
      }
    } catch (error) {
      this.logger.error({ error }, '[AzureAIFoundryProvider] Health check failed');
      return {
        status: 'unhealthy',
        provider: this.name,
        endpoint: this.endpointUrl.replace(/https:\/\/([^.]+)/, 'https://***'),
        error: error instanceof Error ? error.message : 'Unknown error',
        lastChecked: new Date()
      };
    }
  }

  /**
   * Discover models available from Azure AI Foundry catalog.
   * Returns curated list of common Azure AI Foundry models.
   */
  async discoverModels(): Promise<DiscoveredModel[]> {
    // Build set of already-deployed model names for marking
    const deployedIds = new Set<string>();
    const configuredIds = new Set<string>();
    try {
      const existing = await this.listModels();
      for (const m of existing) configuredIds.add(m.id);
    } catch { /* ignore */ }

    const models: DiscoveredModel[] = [];

    // ─── PHASE 1: Currently deployed models via ARM ───
    try {
      const deployments = await this.listDeploymentsViaARM();
      for (const d of deployments) {
        deployedIds.add(d.name);
        const ml = (d.modelName || d.name).toLowerCase();
        models.push({
          id: d.name,
          name: `${d.modelName || d.name}${d.modelVersion ? ` (${d.modelVersion})` : ''}`,
          provider: 'azure-ai-foundry',
          description: `Deployed — ${d.sku}, capacity ${d.capacity}`,
          family: this.inferFamily(ml),
          costTier: this.inferCostTier(ml),
          capabilities: this.inferCapabilities(ml),
          contextWindow: this.inferContextWindow(ml),
          maxOutputTokens: this.inferMaxOutput(ml),
          configured: configuredIds.has(d.name),
          deployed: true,
        } as any);
      }
    } catch (err: any) {
      this.logger.warn({ error: err.message }, '[AIF] ARM deployment discovery failed');
    }

    // PHASE 2 (full catalog dump) intentionally REMOVED. The previous
    // behavior added ~114 "Available — Deploy" rows from the Azure region
    // catalog into Model Garden, which both (a) overwhelmed the UI and
    // (b) violated the hard rule that the Registry is the only SoT —
    // any model the router can pick must come from a real deployment.
    // To deploy a new AIF model: do it in Azure (or via the
    // azure MCP `aif_create_deployment` tool) and it will auto-appear
    // here on the next 5-min refresh + auto-populate the Registry via
    // persistDiscoveredModelsToDb().
    this.logger.info({ deployed: deployedIds.size, total: models.length }, '[AIF] Discovery complete (deployments only — catalog dump disabled)');

    return models;
  }

  /**
   * List ALL models available in the Azure AI model catalog for this region.
   * These are models the admin can deploy — not yet running.
   */
  private async listCatalogModels(): Promise<Array<{
    name: string; version: string; format: string; publisher: string; skus: string[];
  }>> {
    if (!this.useEntraAuth || !this.tenantId || !this.clientId || !this.clientSecret) return [];

    const tokenUrl = `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`;
    const tokenResp = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'https://management.azure.com/.default',
      }).toString(),
      signal: AbortSignal.timeout(10000),
    });
    if (!tokenResp.ok) throw new Error(`ARM token failed: ${tokenResp.status}`);
    const { access_token: armToken } = await tokenResp.json() as any;

    // Get subscription IDs
    const subsResp = await fetch('https://management.azure.com/subscriptions?api-version=2022-12-01', {
      headers: { Authorization: `Bearer ${armToken}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!subsResp.ok) throw new Error(`List subs failed: ${subsResp.status}`);
    const subsData = await subsResp.json() as any;
    const subId = (subsData.value || [])[0]?.subscriptionId;
    if (!subId) return [];

    // Determine region from endpoint URL (e.g., eastus2 from *.cognitiveservices.azure.com)
    // The account location was already resolved in listDeploymentsViaARM — use a default
    const location = 'eastus2'; // TODO: resolve dynamically from account

    const catalogUrl = `https://management.azure.com/subscriptions/${subId}/providers/Microsoft.CognitiveServices/locations/${location}/models?api-version=2024-10-01`;
    const catResp = await fetch(catalogUrl, {
      headers: { Authorization: `Bearer ${armToken}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!catResp.ok) throw new Error(`Catalog API failed: ${catResp.status}`);
    const catData = await catResp.json() as any;

    // Filter to chat-capable models with GlobalStandard (PAYG) SKU
    const results: Array<{ name: string; version: string; format: string; publisher: string; skus: string[] }> = [];
    const seenNames = new Set<string>();

    for (const entry of (catData.value || [])) {
      const model = entry.model || {};
      const name = model.name || '';
      const version = model.version || '';
      const format = model.format || '';
      const publisher = format; // format field contains publisher in this API
      const skus = (model.skus || []).map((s: any) => s.name || '');

      // Only GlobalStandard (PAYG) models
      if (!skus.includes('GlobalStandard')) continue;
      // Skip embeddings, TTS, transcription, audio, realtime
      const nl = name.toLowerCase();
      if (nl.includes('embed') || nl.includes('tts') || nl.includes('transcribe') ||
          nl.includes('audio') || nl.includes('realtime') || nl.includes('whisper') ||
          nl.includes('dall-e') || nl.includes('imagen') || nl.includes('rerank') ||
          nl.includes('document-ai')) continue;
      // Deduplicate by name (keep latest version)
      if (seenNames.has(name)) continue;
      seenNames.add(name);

      results.push({ name, version, format: publisher, publisher, skus });
    }

    return results;
  }

  // ─── H14 / discovery-only inference helpers ───
  //
  // Azure AI Foundry's deployments API returns model name + version, NOT
  // capabilities. The substring checks below populate the *Add Model*
  // discovery picker so the operator sees inferred family/cost-tier/
  // context-window/capabilities BEFORE they save the row to
  // admin.model_role_assignments.
  //
  // Once the row is persisted, ModelCapabilityRegistry.getCapabilities
  // (the registry SoT) trumps every value below. This block MUST NOT be
  // consulted for routing, pricing, or capability gating — only for the
  // discovery picker. Cage exception: tracked in KNOWN_VIOLATORS at 9.

  private inferFamily(ml: string): string {
    if (ml.includes('claude')) return 'claude';
    if (ml.includes('gpt-4.1') || ml.includes('gpt-41')) return 'gpt-4.1';
    if (ml.includes('gpt-5')) return 'gpt-5';
    if (ml.includes('gpt-4o')) return 'gpt-4o';
    if (ml.startsWith('o1') || ml.startsWith('o3') || ml.startsWith('o4')) return 'o-series';
    if (ml.includes('llama')) return 'llama';
    if (ml.includes('mistral')) return 'mistral';
    if (ml.includes('phi')) return 'phi';
    if (ml.includes('grok')) return 'grok';
    if (ml.includes('deepseek')) return 'deepseek';
    if (ml.includes('cohere')) return 'cohere';
    if (ml.includes('qwen')) return 'qwen';
    return 'other';
  }

  private inferCostTier(ml: string): 'free' | 'low' | 'mid' | 'high' | 'premium' {
    if (ml.includes('opus') || ml.includes('gpt-5-pro') || ml.includes('gpt-5.1') || ml.includes('gpt-5.2') || ml.includes('gpt-5.3') || ml.includes('gpt-5.4')) return 'premium';
    if (ml.includes('gpt-5') && !ml.includes('mini') && !ml.includes('nano')) return 'premium';
    if (ml.startsWith('o3') || ml.startsWith('o4') || ml.startsWith('o1')) return 'high';
    if (ml.includes('gpt-4.1') && !ml.includes('mini') && !ml.includes('nano')) return 'high';
    if (ml.includes('sonnet') || ml.includes('mistral-large') || ml.includes('grok')) return 'high';
    if (ml.includes('mini') || ml.includes('nano') || ml.includes('haiku') || ml.includes('small') || ml.includes('flash')) return 'low';
    return 'mid';
  }

  private inferCapabilities(ml: string): Record<string, boolean> {
    return {
      chat: !ml.includes('embed') && !ml.includes('dall-e') && !ml.includes('tts'),
      vision: ml.includes('vision') || ml.includes('gpt-4o') || ml.includes('gpt-5') || ml.includes('claude') || ml.includes('gpt-4.1'),
      tools: !ml.includes('embed') && !ml.includes('dall-e') && !ml.includes('tts'),
      thinking: ml.startsWith('o1') || ml.startsWith('o3') || ml.startsWith('o4') || ml.includes('claude') || ml.includes('deepseek-r1') || ml.includes('reasoning'),
      embeddings: ml.includes('embed'),
      imageGeneration: ml.includes('dall-e') || ml.includes('imagen'),
      streaming: true,
    };
  }

  private inferContextWindow(ml: string): number {
    if (ml.includes('gpt-4.1') || ml.includes('gpt-41')) return 1047576;
    if (ml.includes('claude-opus')) return 200000;
    if (ml.includes('claude-sonnet')) return 200000;
    if (ml.includes('gpt-5')) return 200000;
    if (ml.startsWith('o3') || ml.startsWith('o4')) return 200000;
    if (ml.includes('llama-3.1') || ml.includes('llama-3.2') || ml.includes('llama-3.3') || ml.includes('llama-4')) return 128000;
    if (ml.includes('mistral-large')) return 128000;
    if (ml.includes('deepseek')) return 128000;
    if (ml.includes('grok')) return 128000;
    return 128000;
  }

  private inferMaxOutput(ml: string): number {
    if (ml.startsWith('o3') || ml.startsWith('o1') || ml.startsWith('o4')) return 100000;
    if (ml.includes('claude')) return 64000;
    if (ml.includes('gpt-4.1') || ml.includes('gpt-41')) return 32768;
    if (ml.includes('gpt-5')) return 32768;
    if (ml.includes('deepseek')) return 32768;
    return 16384;
  }

  async getModelDefaults(modelId: string): Promise<Partial<import('./ILLMProvider.js').ProviderDefaultConfig> | null> {
    // Azure AI Foundry supports both Anthropic and OpenAI models.
    // Determine which format based on model name.
    const isAnthropicModel = modelId.toLowerCase().includes('claude');
    if (isAnthropicModel) {
      return {
        supportsTopK: true, supportsFreqPenalty: false, supportsThinking: true,
        thinkingMode: 'budget', temperature: 1.0, topP: 0.999, topK: 40,
        maxTokens: 8192, temperatureRange: [0, 1], maxTokensRange: [256, 128000],
      };
    }
    // OpenAI-style model
    return {
      supportsTopK: false, supportsFreqPenalty: true, supportsThinking: false,
      temperature: 1.0, topP: 1.0, maxTokens: 4096,
      frequencyPenalty: 0, presencePenalty: 0,
      temperatureRange: [0, 2], maxTokensRange: [256, 128000],
    };
  }

  /**
   * #650 — Live provider-pulled model details. Pulls from ARM
   * listDeployments for capabilities/limits and Azure Retail Prices
   * for USD rates.
   *
   * Tests inject `injectedListDeployments` + `injectedPricingFetcher`
   * so the suite runs offline. Production uses listDeploymentsViaARM()
   * with Entra auth and the public Retail Prices API.
   *
   * Reuses existing inferFamily / inferCapabilities / inferContextWindow
   * / inferMaxOutput helpers as private member methods (called via
   * `this.inferXxx`) so capability inference stays consistent with the
   * existing discoverModels() path. No regression to that path.
   */
  async discoverModelDetails(
    modelId: string,
    region?: string,
  ): Promise<import('./discovery/ModelDiscoveryRecord.js').ModelDiscoveryRecord | null> {
    if (!this.initialized) {
      throw new Error('[AzureAIFoundryProvider] not initialized');
    }
    const inferenceRegion = region ?? 'eastus2';

    // 1. ARM deployments — identity + canonical model name.
    const listFn =
      (this as any).injectedListDeployments ??
      (() => this.listDeploymentsViaARM());
    const deployments = await listFn();
    const deployment = (deployments as any[]).find(
      (d: any) => d.name === modelId,
    );
    if (!deployment) {
      throw new Error(
        `[AzureAIFoundryProvider] model ${modelId} is not deployed in this account`,
      );
    }
    const ml = (deployment.modelName ?? deployment.name).toLowerCase();

    // 2. Capabilities + limits via existing inference helpers.
    const family = this.inferFamily(ml);
    const caps = this.inferCapabilities(ml);
    const contextWindow = this.inferContextWindow(ml);
    const maxOutputTokens = this.inferMaxOutput(ml);
    const isThinking = !!caps.thinking;

    // 3. Pricing — Azure Retail Prices API (public, no auth).
    const fetcher =
      (this as any).injectedPricingFetcher ??
      (await import('../pricing/AzureRetailPricesFetcher.js').then(
        (m) => new m.AzureRetailPricesFetcher(),
      ));
    let pricing: any = {
      source: 'azure-retail-prices',
      fetchedAt: new Date().toISOString(),
    };
    try {
      // Pricing is keyed by the underlying Azure base model (`deployment.modelName`,
      // e.g. `gpt-5-mini`), NOT the deployment alias (`gpt-5.4`). Azure Retail
      // Prices meters never reference customer-chosen deployment names.
      const baseModel = (deployment.modelName ?? modelId) as string;
      pricing = await fetcher.fetch({ modelId: baseModel, region: inferenceRegion });
    } catch (err) {
      this.logger.warn(
        { modelId, err: (err as Error).message },
        '[AIF] pricing fetch failed — leaving null',
      );
    }

    return {
      modelId,
      providerType: 'azure-ai-foundry',
      displayName: `${deployment.modelName || modelId}${
        deployment.modelVersion ? ` (${deployment.modelVersion})` : ''
      }`,
      family,
      capabilities: {
        chat: !!caps.chat,
        vision: !!caps.vision,
        tools: !!caps.tools,
        thinking: isThinking,
        embeddings: !!caps.embeddings,
        imageGeneration: !!caps.imageGeneration,
        streaming: !!caps.streaming,
        nativeToolCalling: !!caps.tools && !ml.includes('embed'),
      },
      contextWindow,
      maxOutputTokens,
      thinkingBudget: isThinking ? 8000 : null,
      temperature: 1.0,
      topP: ml.includes('claude') ? 0.999 : 1.0,
      topK: ml.includes('claude') ? 40 : null,
      pricing: {
        inputTokenUsd: pricing.inputTokenUsd ?? null,
        outputTokenUsd: pricing.outputTokenUsd ?? null,
        cacheReadUsd: pricing.cacheReadUsd ?? null,
        cacheWriteUsd: pricing.cacheWriteUsd ?? null,
        thinkingTokenUsd: pricing.thinkingTokenUsd ?? null,
        embeddingTokenUsd: pricing.embeddingTokenUsd ?? null,
        perRequestUsd: pricing.imageGenPerRequestUsd ?? null,
        source: pricing.source ?? 'azure-retail-prices',
        fetchedAt: pricing.fetchedAt ?? new Date().toISOString(),
        region: inferenceRegion,
      },
    };
  }

  static getDefaultConfig(): import('./ILLMProvider.js').ProviderDefaultConfig {
    return {
      maxTokens: 8192, temperature: 1.0, topP: 1.0, topK: 40,
      frequencyPenalty: 0, presencePenalty: 0,
      extendedThinkingEnabled: false, thinkingBudget: 8000, thinkingLevel: '',
      supportsTopK: true, supportsFreqPenalty: true, supportsThinking: true,
      thinkingMode: 'budget',
      temperatureRange: [0, 2], maxTokensRange: [256, 128000], topKRange: [1, 500],
      defaultChatModel: '', defaultEmbeddingModel: '',
    };
  }

  async generateImage(request: import('./ILLMProvider.js').ImageGenerationRequest): Promise<import('./ILLMProvider.js').ImageGenerationResponse> {
    if (!this.initialized) {
      throw new Error('[AzureAIFoundryProvider] Not initialized');
    }

    const model = request.model || 'dall-e-3';
    const startTime = Date.now();

    this.logger.info({ model, promptLength: request.prompt.length }, '[AzureAIFoundryProvider] generateImage started');

    // Build the Azure OpenAI images endpoint
    const baseEndpoint = this.endpointUrl.replace(/\/+$/, '');
    const url = `${baseEndpoint}/openai/deployments/${model}/images/generations?api-version=2024-06-01`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    // Use Entra ID token, ambient DefaultAzureCredential token, or API key
    if (this.useEntraAuth) {
      const token = await this.getEntraToken();
      headers['Authorization'] = `Bearer ${token}`;
    } else if (this.useDefaultAzureCredential) {
      const token = await this.getDefaultAzureCredentialToken();
      headers['Authorization'] = `Bearer ${token}`;
    } else {
      headers['api-key'] = this.apiKey;
    }

    const body: Record<string, any> = {
      prompt: request.prompt,
      n: request.n || 1,
      size: request.size || '1024x1024',
      response_format: 'b64_json',
    };
    if (request.style) {
      body.style = request.style;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.requestTimeout),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown');
      throw new Error(`[AzureAIFoundryProvider] Image generation failed (${response.status}): ${errorText}`);
    }

    const result = await response.json() as any;

    if (!result.data || !result.data[0] || !result.data[0].b64_json) {
      throw new Error('[AzureAIFoundryProvider] No image data in response');
    }

    const durationMs = Date.now() - startTime;
    this.logger.info({ model, durationMs }, '[AzureAIFoundryProvider] generateImage completed');

    return {
      imageBase64: result.data[0].b64_json,
      revisedPrompt: result.data[0].revised_prompt,
      model,
      provider: 'azure-ai-foundry',
      format: 'png',
      generationTimeMs: durationMs,
    };
  }
}

