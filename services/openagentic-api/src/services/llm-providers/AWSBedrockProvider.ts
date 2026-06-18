/**
 * AWS Bedrock Provider
 *
 * Implements ILLMProvider for AWS Bedrock models (Claude, Titan, Jurassic, etc.)
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
  ConverseCommand,
  ConverseStreamCommand,
  type ConverseCommandInput,
  type ConverseStreamCommandInput,
  type ContentBlock,
  type Message as BedrockMessage,
  type Tool as BedrockTool,
  type ToolConfiguration
} from '@aws-sdk/client-bedrock-runtime';
import {
  BedrockClient,
  ListFoundationModelsCommand,
  GetFoundationModelCommand,
  ListInferenceProfilesCommand,
} from '@aws-sdk/client-bedrock';
import {
  bedrockSummaryToDiscoveredModel,
  bedrockInferenceProfileToDiscoveredModel,
  indexFoundationSummaries,
} from './BedrockCapabilityInference.js';
import { toConverseToolConfig } from './helpers/bedrockToolConverter.js';
import { buildBedrockToolDef } from './helpers/bedrockToolExamples.js';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import https from 'https';
import type { Logger } from 'pino';
import {
  BaseLLMProvider,
  type ProviderConfig,
  type CompletionRequest,
  type CompletionResponse,
  type ProviderHealth,
  type DiscoveredModel,
} from './ILLMProvider.js';
import type { CanonicalStreamFormat } from '@agentic-work/llm-sdk/lib/normalizers/index.js';
// Gemma chunks share wire shape with Ollama; OSS routes them through the
// Ollama normalizer (no separate Gemma normalizer in @agentic-work/llm-sdk).
import { createOllamaToOpenagenticNormalizer as createGemmaToOpenagenticNormalizer } from '@agentic-work/llm-sdk/lib/normalizers/index.js';
import { MODELS } from '../../config/models.js';
import {
  assumeRoleWithAADToken,
  type AWSOIDCredentials,
} from './AWSOIDCFederation.js';
// Phase 0.4 — SDK adapter is SoT for Claude-on-Bedrock InvokeModel
// wire shape. The Claude branches of the in-class `convertToBedrock`
// route through this helper now; non-Claude branches (Llama/Nova/Titan)
// still use the in-class converter (separate Phase 0.4 commit).
import { buildBedrockClaudeBody } from './aws/buildBedrockClaudeBody.js';
// #cap-sync (2026-06-16) — the registry is the single source of truth for the
// thinking wire shape (adaptive vs enabled+budget). The provider reads it
// instead of a second inline model regex.
import { getModelCapabilityRegistry } from '../ModelCapabilityRegistry.js';

/**
 * Per-call caller context used for user-scoped credential resolution.
 * When `aadToken` is present, the provider swaps in OIDC-derived creds
 * via AssumeRoleWithWebIdentity instead of the service's default chain.
 */
export interface BedrockCallerContext {
  /** Azure AD ID token of the requesting user. */
  aadToken?: string;
  /** User identifier (email/upn) — drives STS RoleSessionName. */
  userEmail?: string;
}

export interface BedrockConfig {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  endpoint?: string;
  // Standardized model config (from database or environment)
  chatModel?: string;
  embeddingModel?: string;
  visionModel?: string;
  imageModel?: string;
  compactionModel?: string;
  modelId?: string; // Legacy fallback
  // Secondary model for fallback when primary is throttled
  secondaryModel?: string;
  // Retry configuration
  maxRetries?: number;
  initialRetryDelayMs?: number;
  // Inference profile prefix (us, eu, apac) - defaults to 'us' for cross-region
  inferenceProfilePrefix?: string;
  // Private VPC Endpoint configuration
  // When connecting via NLB -> VPC Endpoint, ALPN/HTTP2 negotiation often fails
  // Set forceHttp1=true to disable HTTP/2 and only use HTTP/1.1
  forceHttp1?: boolean;
  // Prompt caching configuration (saves 75%+ on repeated content)
  // See: https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
  enablePromptCaching?: boolean;
}

/**
 * AWS Bedrock now requires inference profiles for on-demand model invocation.
 * This map converts direct model IDs to cross-region inference profile IDs.
 *
 * Format: Direct Model ID → Inference Profile ID
 *
 * Reference: https://docs.aws.amazon.com/bedrock/latest/userguide/cross-region-inference.html
 */
const MODEL_TO_INFERENCE_PROFILE: Record<string, string> = {
  // ═══════════════════════════════════════════════════════════════════════════
  // CLAUDE 4.6 SERIES (Latest - All support thinking, tools, vision)
  // ═══════════════════════════════════════════════════════════════════════════
  // Claude Opus 4.6 - Latest premium model, best quality
  'anthropic.claude-opus-4-6-v1': 'us.anthropic.claude-opus-4-6-v1',
  // Claude Sonnet 4.6 - Latest balanced model, best speed/intelligence
  'anthropic.claude-sonnet-4-6': 'us.anthropic.claude-sonnet-4-6',

  // ═══════════════════════════════════════════════════════════════════════════
  // CLAUDE 4.5 SERIES (All support thinking, tools, vision)
  // ═══════════════════════════════════════════════════════════════════════════
  // Claude Opus 4.5 (legacy, kept for backward compatibility)
  'anthropic.claude-opus-4-5-20251101-v1:0': 'us.anthropic.claude-opus-4-5-20251101-v1:0',
  // Claude Sonnet 4.5 (legacy, kept for backward compatibility)
  'anthropic.claude-sonnet-4-5-20250929-v1:0': 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
  // Claude Haiku 4.5 - Fast/cheap, supports thinking/tools/vision
  'anthropic.claude-haiku-4-5-20251001-v1:0': 'us.anthropic.claude-haiku-4-5-20251001-v1:0',

  // ═══════════════════════════════════════════════════════════════════════════
  // CLAUDE 4.x SERIES
  // ═══════════════════════════════════════════════════════════════════════════
  // Claude Opus 4.1
  'anthropic.claude-opus-4-1-20250805-v1:0': 'us.anthropic.claude-opus-4-1-20250805-v1:0',
  // Claude Opus 4
  'anthropic.claude-opus-4-20250514-v1:0': 'us.anthropic.claude-opus-4-20250514-v1:0',
  // Claude Sonnet 4
  'anthropic.claude-sonnet-4-20250514-v1:0': 'us.anthropic.claude-sonnet-4-20250514-v1:0',

  // ═══════════════════════════════════════════════════════════════════════════
  // CLAUDE 3.x SERIES
  // ═══════════════════════════════════════════════════════════════════════════
  // Claude 3.7 Sonnet
  'anthropic.claude-3-7-sonnet-20250219-v1:0': 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
  // Claude 3.5 Sonnet v2
  'anthropic.claude-3-5-sonnet-20241022-v2:0': 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
  // Claude 3.5 Sonnet v1
  'anthropic.claude-3-5-sonnet-20240620-v1:0': 'us.anthropic.claude-3-5-sonnet-20240620-v1:0',
  // Claude 3.5 Haiku (does NOT support thinking)
  'anthropic.claude-3-5-haiku-20241022-v1:0': 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
  // Claude 3 Opus
  'anthropic.claude-3-opus-20240229-v1:0': 'us.anthropic.claude-3-opus-20240229-v1:0',
  // Claude 3 Sonnet
  'anthropic.claude-3-sonnet-20240229-v1:0': 'us.anthropic.claude-3-sonnet-20240229-v1:0',
  // Claude 3 Haiku
  'anthropic.claude-3-haiku-20240307-v1:0': 'us.anthropic.claude-3-haiku-20240307-v1:0',

  // ═══════════════════════════════════════════════════════════════════════════
  // AMAZON NOVA MODELS
  // ═══════════════════════════════════════════════════════════════════════════
  'amazon.nova-micro-v1:0': 'us.amazon.nova-micro-v1:0',
  'amazon.nova-lite-v1:0': 'us.amazon.nova-lite-v1:0',
  'amazon.nova-pro-v1:0': 'us.amazon.nova-pro-v1:0',
};

/**
 * Bedrock rejects `oneOf` / `allOf` / `anyOf` at the TOP level of a
 * tool's input_schema. The openagentic CLI ships several tools whose
 * top-level schema uses unions to describe variant inputs (e.g. Task
 * with subagent_type vs free-form, AskUserQuestion with multi vs
 * single).
 *
 * The first attempt at this fix kept only the first variant — that
 * worked for Bedrock's validator but stripped sibling fields from the
 * model's view, so the model produced empty/wrong tool inputs (bug
 * symptom: `Grep("")`, `TestRun(tests)` with empty command). The CLI
 * then either timed out (Grep on empty pattern matches everything)
 * or no-op'd (TestRun "no supported framework").
 *
 * Correct behavior: MERGE every variant's `properties` into one flat
 * properties bag with everything optional. The model can fill any
 * combination, the CLI re-validates against the original union schema
 * client-side, and Bedrock no longer sees a forbidden union keyword.
 */
function flattenTopLevelUnions(raw: any): Record<string, any> {
  if (!raw || typeof raw !== 'object') {
    return { type: 'object', properties: {} };
  }
  const cloned: Record<string, any> = { ...raw };
  const unions = ['oneOf', 'allOf', 'anyOf'] as const;
  let touched = false;
  const mergedProps: Record<string, any> = { ...(cloned.properties || {}) };
  for (const k of unions) {
    if (Array.isArray(cloned[k])) {
      for (const variant of cloned[k]) {
        if (variant && typeof variant === 'object' && variant.properties) {
          for (const [pk, pv] of Object.entries(variant.properties)) {
            if (!(pk in mergedProps)) mergedProps[pk] = pv;
          }
        }
      }
      delete cloned[k];
      touched = true;
    }
  }
  if (touched) {
    cloned.properties = mergedProps;
    // Drop required since the union'd variants probably had different
    // required sets — keeping any of them risks 400ing on valid inputs.
    delete cloned.required;
  }
  // Bedrock requires top-level `type: object`.
  if (!cloned.type) cloned.type = 'object';
  if (!cloned.properties) cloned.properties = {};
  return cloned;
}

export class AWSBedrockProvider extends BaseLLMProvider {
  readonly name = 'AWS Bedrock';
  readonly type = 'aws-bedrock' as const;
  // D-1.3 — Bedrock is multi-mode. Claude models stream Anthropic Messages
  // SSE under AWS event-stream framing (`'bedrock-anthropic'`); Nova/Titan
  // use ConverseStream which has its own shape and is not yet wired to a
  // dedicated SDK normalizer (a `'bedrock-converse'` discriminator is the
  // D-2.7 follow-up). The static default reflects the dominant Claude path;
  // `getStreamFormat(request)` below selects per-model.
  readonly streamFormat = 'bedrock-anthropic' as const;

  /**
   * Per-request stream-format dispatch (D-1.3).
   *
   * Mirrors the runtime branch at AWSBedrockProvider.ts:932-944:
   *   - `'anthropic.claude'` model id → `'bedrock-anthropic'`
   *     (InvokeModelWithResponseStream emitting Anthropic-shape SSE under
   *     AWS event-stream framing — handled by createBedrockToOpenagenticNormalizer)
   *   - non-Claude (Nova / Titan / Jurassic) → fallback to `'anthropic'`
   *     until D-2.7 lands a `'bedrock-converse'` normalizer.
   */
  getStreamFormat(request: CompletionRequest): CanonicalStreamFormat {
    const modelId = (request.model || '').toLowerCase();
    if (modelId.includes('anthropic.claude')) {
      return 'bedrock-anthropic';
    }
    // Nova / Titan / Jurassic via ConverseStream — wire-in deferred.
    // Falling back to 'anthropic' keeps the type contract honest; the
    // pipeline-side wire-in (D-3) will gate on the model id and skip
    // SDK normalization for non-Claude until D-2.7.
    return 'anthropic';
  }

  private runtimeClient?: BedrockRuntimeClient;
  private bedrockClient?: BedrockClient;
  private config?: BedrockConfig;

  // Cache for live foundation model listing (5 minute TTL)
  private foundationModelCache?: { models: any[]; timestamp: number };
  private static readonly MODEL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // Retry configuration with defaults
  private readonly maxRetries: number;
  private readonly initialRetryDelayMs: number;
  private readonly secondaryModel?: string;

  // Short-lived LRU of user-scoped BedrockRuntimeClients keyed by AAD token
  // hash. Reuses the same client for the lifetime of the assumed-role
  // credentials, avoiding a new TLS handshake on every chat request.
  private userRuntimeClients: Map<string, { client: BedrockRuntimeClient; expiresAt: number }> = new Map();
  private static readonly USER_CLIENT_LRU_MAX = 64;

  constructor(logger: Logger) {
    super(logger, 'aws-bedrock');
    // Default retry configuration
    this.maxRetries = 5; // More retries for throttling
    this.initialRetryDelayMs = 1000; // Start with 1 second
    // Secondary model from provider config (DB) or env var fallback
    this.secondaryModel = process.env.SECONDARY_MODEL || MODELS.default;
  }

  /**
   * Resolve AWS credentials for a request.
   *
   * - If the caller supplied an AAD ID token, exchange it for short-lived
   *   STS credentials via AssumeRoleWithWebIdentity and return those.
   * - Otherwise return `null` — telling the call-site to use the existing
   *   singleton runtime client (which is bootstrapped from static creds
   *   or the default AWS credential chain at `initialize()` time).
   *
   * This is the seam the Python `_get_credentials_via_direct_oidc` helper
   * sits in; keep the logic purely about credential resolution so the
   * upstream caller can decide how to plumb the result into a client.
   */
  private async resolveCredentials(
    callerContext?: BedrockCallerContext,
  ): Promise<AWSOIDCredentials | null> {
    if (!callerContext?.aadToken) {
      return null;
    }

    try {
      return await assumeRoleWithAADToken(callerContext.aadToken, {
        userEmail: callerContext.userEmail,
        region:
          this.config?.region || process.env.AWS_REGION || 'us-east-1',
      });
    } catch (err) {
      // Surface the failure with the same context the Python ref logs.
      this.logger.error(
        {
          error: err instanceof Error ? err.message : String(err),
          hasUserEmail: !!callerContext.userEmail,
        },
        '❌ [BEDROCK-OIDC] AssumeRoleWithWebIdentity failed — falling back to service creds',
      );
      throw err;
    }
  }

  /**
   * Return a BedrockRuntimeClient appropriate for the caller.
   *
   * - When `callerContext.aadToken` is present, build a fresh client
   *   wired to the OIDC-derived credentials (and cache it briefly so
   *   back-to-back calls from the same user reuse the same socket pool).
   * - When no context is provided (service-init paths), return the
   *   singleton `this.runtimeClient` that was built in `initialize()`.
   */
  private async getBedrockClient(
    callerContext?: BedrockCallerContext,
  ): Promise<BedrockRuntimeClient> {
    if (!callerContext?.aadToken) {
      if (!this.runtimeClient) {
        throw new Error('AWS Bedrock provider not initialized');
      }
      return this.runtimeClient;
    }

    const creds = await this.resolveCredentials(callerContext);
    if (!creds) {
      // resolveCredentials returned null despite aadToken — shouldn't
      // happen in practice, but fall back safely.
      if (!this.runtimeClient) {
        throw new Error('AWS Bedrock provider not initialized');
      }
      return this.runtimeClient;
    }

    // Short-lived per-user client cache keyed by token hash + user email
    // to avoid building a new TLS-backed client per request.
    const crypto = await import('crypto');
    const cacheKey = crypto
      .createHash('sha256')
      .update(`${callerContext.aadToken}|${callerContext.userEmail || ''}`)
      .digest('hex');
    const cached = this.userRuntimeClients.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      // LRU: move to end
      this.userRuntimeClients.delete(cacheKey);
      this.userRuntimeClients.set(cacheKey, cached);
      return cached.client;
    }

    const clientConfig: any = {
      region: this.config?.region || process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        sessionToken: creds.sessionToken,
      },
    };
    if (this.config?.endpoint) {
      clientConfig.endpoint = this.config.endpoint;
    }
    const client = new BedrockRuntimeClient(clientConfig);

    // Cache until 60s before cred expiration so the client is never
    // served with near-expired creds.
    const expiresAt = Math.max(
      creds.expiration.getTime() - 60_000,
      Date.now() + 60_000,
    );
    this.userRuntimeClients.set(cacheKey, { client, expiresAt });

    // Evict oldest entries beyond the LRU budget.
    while (this.userRuntimeClients.size > AWSBedrockProvider.USER_CLIENT_LRU_MAX) {
      const firstKey = this.userRuntimeClients.keys().next().value;
      if (firstKey === undefined) break;
      this.userRuntimeClients.delete(firstKey);
    }

    return client;
  }

  /**
   * Check if an error is a throttling/rate limit error from Bedrock
   */
  private isThrottlingError(error: any): boolean {
    const message = error.message?.toLowerCase() || '';
    const errorName = error.name || '';
    const statusCode = error.$metadata?.httpStatusCode || 0;

    return (
      errorName === 'ThrottlingException' ||
      statusCode === 429 ||
      message.includes('throttlingexception') ||
      message.includes('too many tokens') ||
      message.includes('too many requests') ||
      message.includes('rate exceeded') ||
      message.includes('rate limit')
    );
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  private calculateBackoffDelay(attempt: number): number {
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped)
    const exponentialDelay = this.initialRetryDelayMs * Math.pow(2, attempt);
    const maxDelay = 30000; // Cap at 30 seconds
    const baseDelay = Math.min(exponentialDelay, maxDelay);
    // Add jitter (±25%)
    const jitter = baseDelay * 0.25 * (Math.random() * 2 - 1);
    return Math.floor(baseDelay + jitter);
  }

  /**
   * Sleep for specified milliseconds
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Convert a direct model ID to an inference profile ID for cross-region invocation.
   * AWS Bedrock now REQUIRES inference profiles for on-demand model invocation.
   *
   * If the model ID is already an inference profile (starts with us./eu./apac.),
   * it is returned as-is.
   *
   * If no mapping exists, returns the original model ID (may fail if Bedrock requires profile).
   */
  private toInferenceProfile(modelId: string): string {
    // Defense-in-depth for #577. The primary guard lives at the top of
    // createCompletion — this one catches any other call-site that grows a
    // missing/empty modelId (e.g. a future secondary-model helper). Throwing
    // a typed Error here keeps the "Cannot read properties of undefined
    // (reading 'startsWith')" TypeError from ever leaking again.
    if (typeof modelId !== 'string' || modelId.trim() === '') {
      throw new Error(
        'No Bedrock model configured: toInferenceProfile called without a model id.'
      );
    }

    // Already an inference profile? Validate the :0 suffix is correct.
    // If us.xxx:0 is passed but the MAP has us.xxx (no :0), strip it.
    // If us.xxx is passed but the MAP has us.xxx:0, add it.
    // This handles version suffix mismatches from stale DB entries or env var drift.
    if (modelId.startsWith('us.') || modelId.startsWith('eu.') || modelId.startsWith('apac.')) {
      // Check if this exact profile is a known mapped value
      const knownProfiles = new Set(Object.values(MODEL_TO_INFERENCE_PROFILE));
      if (knownProfiles.has(modelId)) {
        return modelId; // Exact match - good
      }
      // Try toggling the :0 suffix to find the correct form
      if (modelId.endsWith(':0')) {
        const withoutSuffix = modelId.slice(0, -2);
        if (knownProfiles.has(withoutSuffix)) {
          this.logger.warn({ originalModelId: modelId, fixedModelId: withoutSuffix },
            '⚠️ [BEDROCK] Stripped invalid :0 suffix from inference profile (not in mapping with :0)');
          return withoutSuffix;
        }
      } else {
        const withSuffix = modelId + ':0';
        if (knownProfiles.has(withSuffix)) {
          this.logger.warn({ originalModelId: modelId, fixedModelId: withSuffix },
            '⚠️ [BEDROCK] Added missing :0 suffix to inference profile (mapping requires :0)');
          return withSuffix;
        }
      }
      // Not in our known mappings but already has region prefix - pass through
      return modelId;
    }

    // Check explicit mapping
    const mappedProfile = MODEL_TO_INFERENCE_PROFILE[modelId];
    if (mappedProfile) {
      this.logger.info({
        originalModelId: modelId,
        inferenceProfile: mappedProfile
      }, '🔄 [BEDROCK] Converted model ID to inference profile');
      return mappedProfile;
    }

    // Try to auto-generate inference profile for known patterns
    // Format: us.<provider>.<model> for cross-region inference
    const prefix = this.config?.inferenceProfilePrefix || process.env.AWS_BEDROCK_INFERENCE_PREFIX || 'us';

    // Check if this looks like an Anthropic model that needs conversion
    if (modelId.startsWith('anthropic.')) {
      // Try the direct prefix approach
      const autoProfile = `${prefix}.${modelId}`;
      this.logger.warn({
        originalModelId: modelId,
        autoGeneratedProfile: autoProfile,
        warning: 'Model not in explicit mapping - auto-generating profile ID'
      }, '⚠️ [BEDROCK] Auto-generating inference profile for unmapped Anthropic model');
      return autoProfile;
    }

    // For Amazon models (Nova, Titan), try direct prefix
    if (modelId.startsWith('amazon.')) {
      const autoProfile = `${prefix}.${modelId}`;
      this.logger.info({
        originalModelId: modelId,
        inferenceProfile: autoProfile
      }, '🔄 [BEDROCK] Using cross-region profile for Amazon model');
      return autoProfile;
    }

    // Return original for other models (may fail if Bedrock requires profile)
    this.logger.warn({
      modelId,
      warning: 'Model not in inference profile mapping - using direct ID'
    }, '⚠️ [BEDROCK] No inference profile mapping for model');
    return modelId;
  }

  async initialize(config: ProviderConfig['config']): Promise<void> {
    try {
      this.config = config as BedrockConfig;

      const clientConfig: any = {
        region: this.config.region || process.env.AWS_REGION || 'us-east-1'
      };

      // Add credentials if provided (otherwise uses default AWS credential chain)
      if (this.config.accessKeyId && this.config.secretAccessKey) {
        clientConfig.credentials = {
          accessKeyId: this.config.accessKeyId,
          secretAccessKey: this.config.secretAccessKey,
          sessionToken: this.config.sessionToken
        };
      }

      if (this.config.endpoint) {
        clientConfig.endpoint = this.config.endpoint;
      }

      // =========================================================================
      // PRIVATE VPC ENDPOINT SUPPORT (NLB -> VPCE -> Bedrock Runtime)
      // =========================================================================
      // When connecting to Bedrock via a private VPC endpoint behind an NLB,
      // ALPN negotiation for HTTP/2 often fails because:
      //   1. NLB terminates TLS (ACM cert) and re-encrypts to VPCE
      //   2. ALPN protocol list isn't properly forwarded through the NLB
      //   3. VPCE expects ALPN but receives stripped/modified TLS handshake
      //
      // Solution: Force HTTP/1.1 only - don't advertise h2 in ALPN
      // Enable via: AWS_BEDROCK_FORCE_HTTP1=true or config.forceHttp1=true
      // =========================================================================
      const forceHttp1 = this.config.forceHttp1 || process.env.AWS_BEDROCK_FORCE_HTTP1 === 'true';

      if (forceHttp1) {
        this.logger.info({
          endpoint: this.config.endpoint,
          reason: 'Private VPC Endpoint / NLB compatibility'
        }, '🔒 [BEDROCK] Forcing HTTP/1.1 - disabling ALPN h2 advertisement for VPCE compatibility');

        // Create custom HTTPS agent that only advertises HTTP/1.1 in ALPN
        const httpsAgent = new https.Agent({
          keepAlive: true,
          keepAliveMsecs: 30000,
          maxSockets: 50,
          maxFreeSockets: 10,
          timeout: 300000, // 5 minute timeout for long thinking requests
          // CRITICAL: Only advertise HTTP/1.1 in ALPN - do NOT include h2
          // This prevents the "ALPN won't do http2" error with NLB -> VPCE
          ALPNProtocols: ['http/1.1'],
        });

        clientConfig.requestHandler = new NodeHttpHandler({
          httpsAgent,
          requestTimeout: 300000, // 5 minutes
          connectionTimeout: 10000, // 10 seconds to establish connection
        });
      }

      this.runtimeClient = new BedrockRuntimeClient(clientConfig);
      this.bedrockClient = new BedrockClient(clientConfig);

      // IMPORTANT: Validate credentials by making a test API call
      // This prevents the provider from being added if credentials are invalid
      try {
        this.logger.info({ provider: this.name, region: clientConfig.region }, 'Validating AWS Bedrock credentials...');
        
        const testCommand = new ListFoundationModelsCommand({});
        const response = await this.bedrockClient.send(testCommand);
        
        const modelCount = response.modelSummaries?.length || 0;
        this.logger.info({
          provider: this.name,
          modelsAvailable: modelCount,
          region: clientConfig.region,
          endpoint: this.config.endpoint || 'default',
          forceHttp1: forceHttp1,
          protocol: forceHttp1 ? 'HTTP/1.1 (ALPN: http/1.1 only)' : 'HTTP/1.1 or HTTP/2 (default ALPN)'
        }, 'AWS Bedrock credentials validated successfully');

      } catch (credentialError: any) {
        // Clear the clients since they won't work
        this.runtimeClient = undefined;
        this.bedrockClient = undefined;
        this.initialized = false;
        
        const errorMessage = credentialError.message || String(credentialError);
        const isCredentialError = 
          errorMessage.includes('Could not load credentials') ||
          errorMessage.includes('Missing credentials') ||
          errorMessage.includes('ExpiredToken') ||
          errorMessage.includes('InvalidIdentityToken') ||
          errorMessage.includes('AccessDenied') ||
          errorMessage.includes('UnrecognizedClientException') ||
          credentialError.name === 'CredentialsProviderError';

        if (isCredentialError) {
          this.logger.error({
            provider: this.name,
            error: errorMessage,
            region: clientConfig.region,
            hasAccessKeyId: !!this.config.accessKeyId,
            hasSecretAccessKey: !!this.config.secretAccessKey
          }, '❌ AWS Bedrock credentials are invalid or missing. Provider will NOT be available. ' +
             'Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables, ' +
             'or configure IAM role/instance profile, or set AWS_BEDROCK_ENABLED=false to disable.');
          
          throw new Error(
            `AWS Bedrock credential validation failed: ${errorMessage}. ` +
            `Please configure valid AWS credentials or disable AWS Bedrock (AWS_BEDROCK_ENABLED=false).`
          );
        } else {
          // Non-credential error (network, service issue, etc.) - log but allow retry
          this.logger.warn({
            provider: this.name,
            error: errorMessage,
            errorType: credentialError.name
          }, 'AWS Bedrock validation call failed (non-credential error). Provider may work on retry.');
          throw credentialError;
        }
      }

      this.initialized = true;

      // Log model configuration
      this.logger.info({
        provider: this.name,
        region: clientConfig.region,
        endpoint: this.config.endpoint || 'default (public)',
        forceHttp1,
        chatModel: this.config.chatModel || this.config.modelId,
        embeddingModel: this.config.embeddingModel,
        visionModel: this.config.visionModel
      }, 'AWS Bedrock provider initialized with model config');
    } catch (error) {
      this.logger.error({ error, provider: this.name }, 'Failed to initialize AWS Bedrock provider');
      throw error;
    }
  }

  async createCompletion(request: CompletionRequest): Promise<CompletionResponse | AsyncGenerator<any>> {
    if (!this.initialized || !this.runtimeClient) {
      throw new Error('AWS Bedrock provider not initialized');
    }

    // Extract per-request caller context (AAD token / user email) so the
    // STS::AssumeRoleWithWebIdentity path can run for user-scoped calls.
    // The field is Bedrock-specific and threaded via a runtime-only cast
    // to avoid widening the shared CompletionRequest interface for other
    // providers. Upstream callers attach the field on the `request` object
    // before invoking createCompletion. If unset, the per-site helpers
    // fall through to the singleton client built in initialize().
    const callerContext = (request as unknown as {
      callerContext?: BedrockCallerContext;
    }).callerContext;

    const startTime = Date.now();

    // Determine model from request or use default
    const rawModelId = request.model || process.env.AWS_BEDROCK_DEFAULT_MODEL || process.env.ECONOMICAL_MODEL;
    const requestedModelId = typeof rawModelId === 'string' ? rawModelId.trim() : '';

    // #577 — fail loudly with actionable guidance when no model is configured.
    // This used to crash inside toInferenceProfile as
    // "Cannot read properties of undefined (reading 'startsWith')", which the
    // wizard Test Connection UI then surfaced as an opaque TypeError. The
    // live trigger is a freshly-added Bedrock provider with an empty Model
    // Registry and no AWS_BEDROCK_DEFAULT_MODEL env — the right fix is a
    // typed Error the UI can render as "Add a model first".
    if (!requestedModelId) {
      throw new Error(
        'No Bedrock model configured for this request. Add a Bedrock model in ' +
        'the Model Registry (Admin → LLM → Models → Add Model) and re-run the ' +
        'Test Connection, or set AWS_BEDROCK_DEFAULT_MODEL for server-side fallback.'
      );
    }

    const requestedSecondaryModelId = this.config?.secondaryModel || this.secondaryModel;

    // CRITICAL: Convert model IDs to inference profiles for AWS Bedrock
    // AWS Bedrock now REQUIRES inference profiles for on-demand model invocation
    const primaryModelId = this.toInferenceProfile(requestedModelId);
    const secondaryModelId = requestedSecondaryModelId ? this.toInferenceProfile(requestedSecondaryModelId) : undefined;

    this.logger.info({
      requestedModel: requestedModelId,
      resolvedModel: primaryModelId,
      requestedSecondary: requestedSecondaryModelId,
      resolvedSecondary: secondaryModelId,
      wasConverted: requestedModelId !== primaryModelId
    }, '🎯 [BEDROCK] Model ID resolution for completion request');

    let lastError: Error | null = null;
    let currentModelId = primaryModelId;
    let totalRetries = 0;

    // Try with retry and model fallback
    for (let modelAttempt = 0; modelAttempt < 2; modelAttempt++) {
      // On second attempt, try secondary model if available
      if (modelAttempt === 1) {
        if (!secondaryModelId || secondaryModelId === currentModelId) {
          // No secondary model or same as primary, throw the last error
          break;
        }
        currentModelId = secondaryModelId;
        this.logger.info({
          primaryModel: primaryModelId,
          fallbackModel: currentModelId,
          reason: 'throttling'
        }, '🔄 [BEDROCK] Falling back to secondary model after throttling');
      }

      // Body shape depends on whether we're going through InvokeModel
      // (Claude only) or Converse (everyone else). convertToBedrock's
      // non-Claude branches produce inputText / prompt / etc. shapes that
      // Converse cannot consume — if we're heading to Converse, keep the
      // raw OpenAI-shape request on the body so convertToConverseMessages
      // can translate it uniformly. That's also how AWS itself positions
      // the Converse API: "one API to interact with any Bedrock model."
      const isClaudeModel = currentModelId.includes('anthropic.claude');
      // Phase 0.4 (2026-05-12) — Claude branch routes through the SDK
      // outbound adapter via buildBedrockClaudeBody. Wire-shape is
      // byte-identical to Anthropic.com direct (proven by
      // buildAnthropicWireBody.real round-trip), with Bedrock-specific
      // anthropic_version + model-strip. The legacy convertToBedrock
      // Claude branch stays in-class temporarily for non-Claude models
      // (Llama/Nova/Titan have different wire shapes).
      // Bedrock-Claude thinking support: Sonnet 4.x / Opus 4.x / Haiku 4.5
      // accept the `thinking` field; older Claude 3.x do not. Inline name
      // pattern instead of a separate method since the gate is simple.
      //
      // Operator off-switch (2026-05-12): `BEDROCK_EXTENDED_THINKING_ENABLED=false`
      // disables thinking globally regardless of model. Helm-tunable; flips at
      // pod restart. Use when thinking budget cost > value, or when temperature
      // overrides are needed (Anthropic forbids non-1 temperature with thinking
      // on, so disabling thinking is the only way to use 0.7 / 0.5 / etc).
      // Per-message / per-model overrides are a follow-up if needed.
      const extendedThinkingEnvEnabled =
        process.env.BEDROCK_EXTENDED_THINKING_ENABLED !== 'false';
      const supportsThinking =
        extendedThinkingEnvEnabled && (
          /claude-(opus|sonnet|haiku)-4-/.test(currentModelId.toLowerCase()) ||
          currentModelId.toLowerCase().includes('claude-3-7-sonnet')
        );
      // #cap-sync (2026-06-16) — the registry is the SINGLE source of truth for
      // the thinking WIRE shape. Opus 4.7/4.8 + Fable 5 are adaptive-only
      // (`{type:'enabled', budget_tokens}` 400s); ≤ Opus 4.6 / Sonnet 4.6 use
      // the legacy fixed budget. Read `thinkingCapabilities.thinkingMode` off
      // the resolved registry row instead of a second inline regex.
      const thinkingMode: 'enabled' | 'adaptive' = (() => {
        try {
          const reg = getModelCapabilityRegistry();
          const mode = reg?.getCapabilities(currentModelId)?.thinkingCapabilities?.thinkingMode;
          return mode === 'adaptive' ? 'adaptive' : 'enabled';
        } catch {
          return 'enabled';
        }
      })();
      // Adaptive mode carries no budget — leave it undefined so the wire helper
      // skips the budget-floor on max_tokens.
      const thinkingBudget = supportsThinking && thinkingMode === 'enabled'
        ? parseInt(process.env.BEDROCK_THINKING_BUDGET_TOKENS || '4096', 10)
        : undefined;
      // Sev-1 #794 (2026-05-13) — model's real output-token ceiling.
      // The provider-config layer (ProviderManager.executeCompletion) has
      // ALREADY substituted `modelConfig.maxTokens` (sourced from the
      // ModelConfigurationService → registry row's `max_tokens` column OR
      // the AWS_BEDROCK_MAX_TOKENS env var) into `request.max_tokens` when
      // the caller omitted it (ProviderManager.ts:1349). When even that
      // upstream substitution is undefined (early-boot paths, test harnesses,
      // or fresh deploys without the env set), we fall back to the model-
      // ID-derived ceiling so synth code-gen / compose_app gets the full
      // 32K-128K window Bedrock-Claude actually supports — instead of the
      // canonical-default 4096 trap.
      const inferredCap = this.inferMaxOutputTokens(currentModelId);
      const modelOutputCap = inferredCap > 0 ? inferredCap : undefined;
      const claudeWireBody = isClaudeModel
        ? buildBedrockClaudeBody(request, {
            parallelOn: true, // Bedrock-Claude defaults to parallel-on
            supportsThinking,
            thinkingMode,            // #cap-sync — adaptive for Opus 4.7/4.8
            thinkingBudgetTokens: thinkingBudget,
            modelOutputCap,
          })
        : undefined;
      const body = isClaudeModel
        ? claudeWireBody!
        : {
            // Drop system messages from the array — Converse takes them
            // separately on the `system` field. Without this filter, a
            // [{role:'system'}, {role:'user'}] input would be serialized
            // with the system message first and AWS rejects with
            // "conversation must start with a user message".
            messages: request.messages.filter(m => m.role !== 'system'),
            system: request.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n') || undefined,
            tools: (request as any).tools,
            temperature: request.temperature,
            max_tokens: request.max_tokens,
            top_p: request.top_p,
          };

      // Retry loop with exponential backoff
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          if (request.stream) {
            return await this.streamCompletionWithRetry(currentModelId, body, startTime, attempt, callerContext);
          } else {
            return await this.nonStreamCompletion(currentModelId, body, startTime, callerContext);
          }
        } catch (error: any) {
          lastError = error;
          totalRetries++;

          // If not a throttling error, don't retry - throw immediately
          if (!this.isThrottlingError(error)) {
            this.trackFailure();
            this.logger.error({
              error: error.message,
              model: currentModelId,
              attempt,
              errorType: error.name,
              provider: this.name
            }, 'Bedrock completion failed (non-throttling error)');
            throw error;
          }

          // If we've exhausted retries for this model, break to try fallback
          if (attempt >= this.maxRetries) {
            this.logger.warn({
              model: currentModelId,
              attempts: attempt + 1,
              totalRetries,
              errorType: error.name,
              errorMessage: error.message
            }, '⚠️ [BEDROCK] Exhausted retries for throttling, trying fallback model');
            break;
          }

          // Calculate backoff delay
          const delayMs = this.calculateBackoffDelay(attempt);

          this.logger.warn({
            model: currentModelId,
            attempt: attempt + 1,
            maxRetries: this.maxRetries,
            delayMs,
            errorType: error.name,
            errorMessage: error.message
          }, `⏳ [BEDROCK] Throttling detected, retrying in ${delayMs}ms`);

          await this.sleep(delayMs);
        }
      }
    }

    // All attempts failed
    this.trackFailure();
    this.logger.error({
      primaryModel: primaryModelId,
      secondaryModel: secondaryModelId,
      totalRetries,
      error: lastError?.message,
      provider: this.name
    }, '❌ [BEDROCK] All retry attempts and model fallbacks failed');

    throw lastError || new Error('Bedrock completion failed after all retries');
  }

  /**
   * Stream completion with retry support
   * Returns the generator directly if successful
   */
  private async streamCompletionWithRetry(
    modelId: string,
    body: any,
    startTime: number,
    attempt: number,
    callerContext?: BedrockCallerContext,
  ): Promise<AsyncGenerator<any>> {
    // For streaming, we need to handle throttling at the initial request level
    // The generator itself shouldn't need retry logic since throttling happens upfront
    return this.streamCompletion(modelId, body, startTime, callerContext);
  }

  private async nonStreamCompletion(
    modelId: string,
    body: any,
    startTime: number,
    callerContext?: BedrockCallerContext,
  ): Promise<CompletionResponse> {
    // Non-Claude models on Bedrock (Nova, Llama, Nemotron, Mistral, etc.)
    // reject InvokeModel with Anthropic-shaped bodies ("Failed to deserialize
    // the JSON body"). Route them through Converse, same gate as
    // streamCompletion() uses for the streaming path.
    const isClaudeModel = modelId.includes('anthropic.claude');
    if (!isClaudeModel) {
      return this.nonStreamWithConverseAPI(modelId, body, startTime, callerContext);
    }

    const command = new InvokeModelCommand({
      modelId,
      body: JSON.stringify(body),
      contentType: 'application/json',
      accept: 'application/json'
    });

    const client = await this.getBedrockClient(callerContext);
    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    const latency = Date.now() - startTime;

    // Parse response based on model type
    const parsedResponse = this.parseBedrockResponse(modelId, responseBody);

    // Track metrics
    const tokens = parsedResponse.usage?.total_tokens || 0;
    const cost = this.estimateCost(modelId, tokens);
    this.trackSuccess(latency, tokens, cost);

    return parsedResponse;
  }

  /**
   * Non-streaming completion via Converse API. Mirrors streamWithConverseAPI
   * for the non-stream case — Converse normalizes Nova/Llama/Nemotron/Mistral
   * body shapes so one path handles every non-Claude Bedrock model.
   */
  private async nonStreamWithConverseAPI(
    modelId: string,
    body: any,
    startTime: number,
    callerContext?: BedrockCallerContext,
  ): Promise<CompletionResponse> {
    const converseInput: ConverseCommandInput = {
      modelId,
      messages: this.convertToConverseMessages(body.messages),
      inferenceConfig: body.inferenceConfig || {
        maxTokens: body.max_tokens || 4096,
        temperature: body.temperature ?? 1,
      },
    };

    if (body.system) {
      converseInput.system = Array.isArray(body.system)
        ? body.system
        : [{ text: body.system }];
    }
    if (body.tools && body.tools.length > 0) {
      converseInput.toolConfig = toConverseToolConfig(body.tools) as ConverseCommandInput['toolConfig'];
    }

    this.logger.info({ modelId }, '🔵 [CONVERSE-API] Non-stream request');
    const command = new ConverseCommand(converseInput);
    const client = await this.getBedrockClient(callerContext);
    const response = await client.send(command);

    const latency = Date.now() - startTime;
    const msg = response.output?.message;
    const content = msg?.content || [];
    const textBlock = content.find((b: any) => typeof b.text === 'string');
    const toolUseBlocks = content.filter((b: any) => b.toolUse);
    // #647 — surface Converse reasoningContent blocks so V2/codemode can
    // render Sonnet/Nova thinking. Concatenate when multiple blocks
    // arrive in one response. Streaming path already emits these as
    // thinking_delta (line ~1226); non-stream silently dropped them.
    const reasoningText = content
      .filter((b: any) => b.reasoningContent?.reasoningText?.text)
      .map((b: any) => b.reasoningContent.reasoningText.text)
      .join('');
    const usage: any = response.usage || {};
    const totalTokens = (usage.inputTokens || 0) + (usage.outputTokens || 0);
    const cost = this.estimateCost(modelId, totalTokens);
    this.trackSuccess(latency, totalTokens, cost);

    const openAIShape: any = {
      id: `bedrock-converse-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: textBlock?.text || '',
          ...(reasoningText && { reasoning_content: reasoningText }),
          ...(toolUseBlocks.length > 0 && {
            tool_calls: toolUseBlocks.map((b: any) => ({
              id: b.toolUse.toolUseId,
              type: 'function',
              function: {
                name: b.toolUse.name,
                arguments: JSON.stringify(b.toolUse.input || {}),
              },
            })),
          }),
        },
        finish_reason: response.stopReason === 'tool_use' ? 'tool_calls'
          : response.stopReason === 'max_tokens' ? 'length'
          : 'stop',
      }],
      usage: {
        prompt_tokens: usage.inputTokens || 0,
        completion_tokens: usage.outputTokens || 0,
        total_tokens: totalTokens,
      },
    };
    return openAIShape;
  }

  private async *streamCompletion(
    modelId: string,
    body: any,
    startTime: number,
    callerContext?: BedrockCallerContext,
  ): AsyncGenerator<any> {
    // Route to appropriate streaming API based on model:
    // - Claude models: InvokeModelWithResponseStream (native Anthropic format)
    // - Nova/Other models: ConverseStream (unified format, better streaming support)
    const isClaudeModel = modelId.includes('anthropic.claude');

    if (!isClaudeModel) {
      // Use ConverseStream for non-Claude models (Nova, Titan, etc.)
      this.logger.info({ modelId }, '[AWSBedrockProvider] Using ConverseStream for non-Claude model');
      yield* this.streamWithConverseAPI(modelId, body, startTime, callerContext);
      return;
    }

    // For Claude models, use InvokeModelWithResponseStream (native Anthropic format)
    this.logger.info({ modelId }, '[AWSBedrockProvider] Using InvokeModelWithResponseStream for Claude model');
    const command = new InvokeModelWithResponseStreamCommand({
      modelId,
      body: JSON.stringify(body),
      contentType: 'application/json',
      accept: 'application/json'
    });

    const client = await this.getBedrockClient(callerContext);
    const response = await client.send(command);

    if (!response.body) {
      throw new Error('No response body from Bedrock streaming');
    }

    let totalTokens = 0;

    let chunkNum = 0;
    let hasContent = false;
    for await (const event of response.body) {
      if (event.chunk) {
        chunkNum++;
        const rawBytes = new TextDecoder().decode(event.chunk.bytes);
        const chunk = JSON.parse(rawBytes);

        // DEBUG: Log ALL raw chunks from Bedrock to understand the actual response format
        this.logger.info({
          chunkNum,
          rawChunkType: chunk.type,
          rawChunkKeys: Object.keys(chunk),
          hasContent: !!chunk.content,
          hasContentBlock: !!chunk.content_block,
          hasDelta: !!chunk.delta,
          rawChunk: rawBytes.substring(0, 2000)
        }, '[BEDROCK-RAW] 📡 Raw chunk from InvokeModelWithResponseStream');

        // Track if any chunk has actual content
        if (chunk.type === 'content_block_start' || chunk.type === 'content_block_delta' ||
            chunk.delta?.type === 'text_delta' || chunk.delta?.type === 'thinking_delta') {
          hasContent = true;
        }

        const converted = this.convertStreamChunk(modelId, chunk);
        if (converted) {
          yield converted;
          if (chunk.usage?.total_tokens) {
            totalTokens = chunk.usage.total_tokens;
          }
        }
      }
    }

    // Log summary of what we received
    this.logger.info({
      totalChunks: chunkNum,
      hasContent,
      totalTokens,
      modelId
    }, '[BEDROCK-RAW] 📊 Stream summary');

    const latency = Date.now() - startTime;
    const cost = this.estimateCost(modelId, totalTokens);
    this.trackSuccess(latency, totalTokens, cost);
  }

  /**
   * Stream completion using the Converse API for Claude models.
   * This API properly returns content_block events for interleaved thinking/text/tool_use.
   */
  private async *streamWithConverseAPI(
    modelId: string,
    body: any,
    startTime: number,
    callerContext?: BedrockCallerContext,
  ): AsyncGenerator<any> {
    // Convert our internal format to Converse API format
    // Note: For Nova models, body may already have inferenceConfig from convertToBedrock
    //
    // Sev-1 #794 (2026-05-13) — fall through to the model's real output
    // ceiling when neither caller nor provider config supplied max_tokens.
    // Previously hardcoded to 32768; that ignored e.g. Nova Pro (5120)
    // and Llama-3 (4096) which reject larger values, AND under-allocated
    // for Claude-3.7 / 4.x which support 128K.
    const converseInput: ConverseStreamCommandInput = {
      modelId,
      messages: this.convertToConverseMessages(body.messages),
      inferenceConfig: body.inferenceConfig || {
        maxTokens: body.max_tokens || this.inferMaxOutputTokens(modelId),
        temperature: body.temperature ?? 1,
      },
    };

    // Add system prompt if present with caching support
    // Handle both string format (from Claude) and array format (from Nova)
    const enableCaching = this.config?.enablePromptCaching ??
                         process.env.AWS_BEDROCK_ENABLE_CACHING === 'true';

    if (body.system) {
      if (Array.isArray(body.system)) {
        // Nova format: [{text: ...}] - add cachePoint if enabled
        if (enableCaching && body.system.length > 0) {
          converseInput.system = [
            ...body.system,
            { cachePoint: { type: 'default' } } as any
          ];
        } else {
          converseInput.system = body.system;
        }
      } else {
        // Claude format: string - wrap in array with optional cachePoint
        if (enableCaching && body.system.length >= 1024) {
          converseInput.system = [
            { text: body.system },
            { cachePoint: { type: 'default' } } as any
          ];
          this.logger.info({
            systemLength: body.system.length,
            caching: true
          }, '💾 [CONVERSE] System prompt caching enabled');
        } else {
          converseInput.system = [{ text: body.system }];
        }
      }
    }

    // Add tools if present. Centralized helper handles both Anthropic-flat
    // and OpenAI-function formats. Tools without a resolvable name are
    // dropped (regression: Smart Router null-name crash, 2026-04-23).
    if (body.tools && body.tools.length > 0) {
      const converted = toConverseToolConfig(body.tools);
      if (converted.tools.length > 0) {
        // Re-apply flattenTopLevelUnions to each tool's inputSchema.json to
        // preserve Bedrock's existing anyOf/oneOf normalization behavior.
        converted.tools = converted.tools.map(t => ({
          toolSpec: {
            ...t.toolSpec,
            inputSchema: { json: flattenTopLevelUnions(t.toolSpec.inputSchema.json) },
          },
        }));
        converseInput.toolConfig = converted as ConverseStreamCommandInput['toolConfig'];
      }
    }

    // Add thinking configuration if enabled
    if (body.thinking?.type === 'enabled') {
      (converseInput as any).performanceConfig = {
        latency: 'standard'
      };
      // Bedrock Converse API uses additionalModelRequestFields for thinking
      (converseInput as any).additionalModelRequestFields = {
        thinking: {
          type: 'enabled',
          budget_tokens: body.thinking.budget_tokens || 10000
        }
      };
    }

    this.logger.info({
      modelId,
      messageCount: converseInput.messages?.length,
      hasTools: !!converseInput.toolConfig,
      hasThinking: !!(converseInput as any).additionalModelRequestFields?.thinking,
      thinkingBudget: (converseInput as any).additionalModelRequestFields?.thinking?.budget_tokens
    }, '🔵 [CONVERSE-API] Starting ConverseStream request');

    const command = new ConverseStreamCommand(converseInput);
    const client = await this.getBedrockClient(callerContext);
    const response = await client.send(command);

    if (!response.stream) {
      throw new Error('No stream in Converse API response');
    }

    let totalTokens = 0;
    let blockIndex = 0;

    // Gemma 3 has no native tool_use blocks — it leaks `\`\`\`tool_calls`
    // fenced blocks in the text stream. Route Bedrock-Gemma deltas through
    // the SDK normalizer to recover canonical tool_use content_blocks.
    // Verified against `google.gemma-3-27b-it` on the dev environment 2026-05-20.
    const isGemmaModel =
      modelId.includes('google.gemma') || /gemma-?3/i.test(modelId);
    const gemmaNormalizer = isGemmaModel
      ? createGemmaToOpenagenticNormalizer({
          messageId: `bedrock-gemma-${Date.now()}`,
          model: modelId,
        })
      : null;
    let gemmaPromotedStopReason: string | null = null;
    if (isGemmaModel) {
      this.logger.info(
        { modelId },
        '[CONVERSE] Gemma detected — routing text deltas through GemmaToOpenagentic normalizer for inline tool_call extraction',
      );
    }

    // Emit message_start
    yield {
      id: `bedrock-converse-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{
        index: 0,
        delta: { role: 'assistant' },
        finish_reason: null
      }]
    };

    for await (const event of response.stream) {
      this.logger.debug({
        eventKeys: Object.keys(event),
        hasContentBlockStart: !!event.contentBlockStart,
        hasContentBlockDelta: !!event.contentBlockDelta,
        hasContentBlockStop: !!event.contentBlockStop,
        hasMessageStop: !!event.messageStop,
        hasMetadata: !!event.metadata
      }, '🔍 [CONVERSE-RAW] Stream event');

      // Handle content block start
      if (event.contentBlockStart) {
        const start = event.contentBlockStart;
        blockIndex = start.contentBlockIndex ?? blockIndex;

        // Determine block type from start event
        if (start.start?.toolUse) {
          yield {
            type: 'content_block_start',
            index: blockIndex,
            content_block: {
              type: 'tool_use',
              id: start.start.toolUse.toolUseId,
              name: start.start.toolUse.name
            }
          };
          this.logger.debug({ index: blockIndex, toolName: start.start.toolUse.name }, '[CONVERSE] tool_use block start');
        } else if ((start.start as any)?.reasoningContent) {
          // Extended thinking/reasoning block
          yield {
            type: 'content_block_start',
            index: blockIndex,
            content_block: { type: 'thinking' }
          };
          this.logger.debug({ index: blockIndex }, '[CONVERSE] thinking block start');
        } else {
          // Default to text block. For Gemma we SUPPRESS this upstream
          // emission because the normalizer creates its own content_block
          // events at the right time (only after seeing real text outside
          // a tool_call fence, with its own block-index management).
          if (!gemmaNormalizer) {
            yield {
              type: 'content_block_start',
              index: blockIndex,
              content_block: { type: 'text' }
            };
            this.logger.debug({ index: blockIndex }, '[CONVERSE] text block start');
          }
        }
      }

      // Handle content block delta
      if (event.contentBlockDelta) {
        const delta = event.contentBlockDelta;
        const idx = delta.contentBlockIndex ?? blockIndex;

        if (delta.delta?.text) {
          // Gemma branch — pipe text through normalizer, forward canonical
          // events. Normalizer extracts fenced ```tool_calls blocks into
          // tool_use content_blocks; plain text flows through as text_delta.
          if (gemmaNormalizer) {
            const events = gemmaNormalizer.consume({ message: { content: delta.delta.text } } as any);
            for (const evt of events) {
              if (evt.type === 'message_start' || evt.type === 'message_stop') continue;
              if (evt.type === 'message_delta') {
                gemmaPromotedStopReason = evt.delta.stop_reason;
                continue;
              }
              yield evt;
            }
            continue;
          }
          yield {
            type: 'content_block_delta',
            index: idx,
            delta: {
              type: 'text_delta',
              text: delta.delta.text
            }
          };
        } else if (delta.delta?.toolUse) {
          // Tool use delta - the input comes as partial JSON string
          const partialJson = (delta.delta.toolUse as any).input || '';
          yield {
            type: 'content_block_delta',
            index: idx,
            delta: {
              type: 'input_json_delta',
              partial_json: partialJson
            }
          };
        } else if ((delta.delta as any)?.reasoningContent) {
          // Extended thinking/reasoning delta (Converse API uses reasoningContent)
          const reasoning = (delta.delta as any).reasoningContent;
          const thinkingText = reasoning?.text || reasoning || '';
          yield {
            type: 'content_block_delta',
            index: idx,
            delta: {
              type: 'thinking_delta',
              thinking: thinkingText
            }
          };
          this.logger.debug({ index: idx, length: thinkingText.length }, '[CONVERSE] thinking delta');
        }
      }

      // Handle content block stop. Suppressed for Gemma — the normalizer
      // emits its own content_block_stop when the fenced block (or text
      // segment) closes.
      if (event.contentBlockStop && !gemmaNormalizer) {
        yield {
          type: 'content_block_stop',
          index: event.contentBlockStop.contentBlockIndex ?? blockIndex
        };
        blockIndex++;
      }

      // Handle message stop with usage
      if (event.messageStop) {
        const rawStopReason = event.messageStop.stopReason;
        // Gemma: finalize the normalizer, flush any pending block-stop,
        // and use the promoted stop_reason if a tool_call was extracted
        // (Bedrock reports "end_turn" but we promoted to "tool_use" so
        // chatLoop dispatches correctly).
        let stopReason: string | undefined = rawStopReason;
        if (gemmaNormalizer) {
          const finalEvents = gemmaNormalizer.finalize();
          for (const evt of finalEvents) {
            if (evt.type === 'message_start' || evt.type === 'message_stop') continue;
            if (evt.type === 'message_delta') {
              gemmaPromotedStopReason = evt.delta.stop_reason;
              continue;
            }
            yield evt;
          }
          if (gemmaPromotedStopReason === 'tool_use') stopReason = 'tool_use';
        }
        yield {
          id: `bedrock-converse-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: stopReason === 'tool_use' ? 'tool_calls' : 'stop'
          }]
        };
      }

      // Handle metadata (usage info including cache metrics)
      if (event.metadata) {
        const usage = event.metadata.usage;
        if (usage) {
          totalTokens = (usage.inputTokens || 0) + (usage.outputTokens || 0);

          // Log cache metrics if available (Bedrock prompt caching)
          const cacheReadTokens = (usage as any).cacheReadInputTokenCount || 0;
          const cacheWriteTokens = (usage as any).cacheWriteInputTokenCount || 0;

          if (cacheReadTokens > 0 || cacheWriteTokens > 0) {
            const cacheSavings = cacheReadTokens > 0
              ? Math.round((cacheReadTokens / (usage.inputTokens || 1)) * 100)
              : 0;
            this.logger.info({
              cacheReadTokens,
              cacheWriteTokens,
              totalInputTokens: usage.inputTokens,
              cacheSavingsPercent: cacheSavings
            }, `💾 [CONVERSE] Cache metrics: ${cacheSavings}% of input tokens from cache`);
          }

          yield {
            id: `bedrock-converse-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: modelId,
            choices: [{ index: 0, delta: {}, finish_reason: null }],
            usage: {
              prompt_tokens: usage.inputTokens || 0,
              completion_tokens: usage.outputTokens || 0,
              total_tokens: totalTokens,
              // Include cache metrics in response for downstream tracking
              cache_read_tokens: cacheReadTokens,
              cache_write_tokens: cacheWriteTokens
            }
          };
        }
      }
    }

    const latency = Date.now() - startTime;
    const cost = this.estimateCost(modelId, totalTokens);
    this.trackSuccess(latency, totalTokens, cost);
  }

  /**
   * Convert internal message format to Converse API message format
   */
  private convertToConverseMessages(messages: any[]): BedrockMessage[] {
    const result: BedrockMessage[] = [];

    // Defensive: ensure messages is iterable (failover paths may pass non-array)
    if (!Array.isArray(messages)) {
      if (messages && typeof messages === 'object') {
        // Single message object — wrap in array
        messages = [messages];
      } else {
        return result;
      }
    }

    for (const msg of messages) {
      if (msg.role === 'system') continue; // System handled separately

      const content: ContentBlock[] = [];

      // Handle array content (already has content blocks)
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          // Handle blocks with explicit type='text'
          if (block.type === 'text') {
            content.push({ text: block.text });
          }
          // CRITICAL FIX: Handle Nova-style blocks that have {text: ...} without type property
          // This happens when messages pass through convertToBedrock for Nova before reaching here
          else if (block.text !== undefined && !block.type) {
            content.push({ text: block.text });
          } else if (block.type === 'tool_use') {
            content.push({
              toolUse: {
                toolUseId: block.id,
                name: block.name,
                input: block.input || {}
              }
            });
          } else if (block.type === 'tool_result') {
            content.push({
              toolResult: {
                toolUseId: block.tool_use_id,
                content: [{ text: typeof block.content === 'string' ? block.content : JSON.stringify(block.content) }]
              }
            });
          }
          // Skip thinking/redacted_thinking blocks for now
        }
      } else if (typeof msg.content === 'string' && msg.content) {
        content.push({ text: msg.content });
      }

      // Handle tool_calls from OpenAI format
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          let input = {};
          try {
            input = JSON.parse(tc.function?.arguments || '{}');
          } catch { /* ignore */ }
          content.push({
            toolUse: {
              toolUseId: tc.id,
              name: tc.function?.name || '',
              input
            }
          });
        }
      }

      if (content.length > 0) {
        result.push({
          role: msg.role === 'assistant' ? 'assistant' : 'user',
          content
        });
      }
    }

    return result;
  }

  private convertToBedrock(request: CompletionRequest, modelId: string): any {
    // Anthropic Claude models
    if (modelId.includes('anthropic.claude')) {
      const systemMessages = request.messages.filter(m => m.role === 'system');
      const nonSystemMessages = request.messages.filter(m => m.role !== 'system');

      // Check if thinking mode is enabled for this request
      const thinkingEnabled = (request as any).thinking?.type === 'enabled';

      // Convert messages to Anthropic format with proper tool handling
      const convertedMessages: any[] = [];

      for (let i = 0; i < nonSystemMessages.length; i++) {
        const m = nonSystemMessages[i];

        // Check if content is already array-formatted (from previous turns with thinking/tool_use)
        const isArrayContent = Array.isArray(m.content);

        // Skip messages with empty content (except for assistant messages with tool_calls or last assistant message)
        const hasContent = isArrayContent ? m.content.length > 0 : (m.content && m.content.trim());
        const hasToolCalls = m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0;
        const isLastAssistant = i === nonSystemMessages.length - 1 && m.role === 'assistant';

        if (!hasContent && !hasToolCalls && !isLastAssistant) {
          continue;
        }

        // Handle assistant messages with array-format content (already has thinking/tool_use blocks)
        if (m.role === 'assistant' && isArrayContent) {
          let contentBlocks: any[] = [...m.content];

          // When thinking is enabled, Claude requires assistant messages to start with thinking block
          // Check if first block is already a thinking block
          const hasThinkingBlock = contentBlocks.some((b: any) =>
            b.type === 'thinking' || b.type === 'redacted_thinking'
          );
          const hasToolUseBlock = contentBlocks.some((b: any) => b.type === 'tool_use');

          // NOTE: We previously tried to inject fake redacted_thinking blocks here, but that fails
          // because redacted_thinking blocks require valid encrypted 'data' from actual API responses.
          // Instead, we should NOT inject any thinking blocks - the model will handle it.
          // If this causes issues, the solution is to disable thinking for requests with
          // message history that doesn't have thinking blocks (can't toggle mid-conversation).
          if (thinkingEnabled && hasToolUseBlock && !hasThinkingBlock) {
            this.logger.debug({ messageIndex: i }, 'Assistant message has tool_use but no thinking block - not injecting fake blocks');
          }

          // Sanitize content blocks before sending to Bedrock
          for (const block of contentBlocks) {
            // IMPORTANT: Keep 'data' field on existing redacted_thinking blocks!
            // When resending messages from previous turns, the 'data' field contains
            // encrypted thinking content that Claude needs for conversation continuity.
            // We do NOT delete block.data - it breaks multi-turn conversations.

            // CRITICAL: Ensure tool_use.input is ALWAYS a valid dictionary
            // Bedrock rejects requests where tool_use.input is not a plain object
            if (block.type === 'tool_use') {
              let input = block.input;

              if (typeof input === 'string') {
                // Try to parse JSON string
                try {
                  const parsed = JSON.parse(input);
                  input = (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
                    ? parsed
                    : { value: parsed };
                } catch {
                  input = { raw: input };
                }
              } else if (input === null || input === undefined) {
                input = {};
              } else if (Array.isArray(input)) {
                input = { items: input };
              } else if (typeof input !== 'object') {
                input = { value: input };
              } else {
                // Clone to ensure plain object (no prototype issues)
                try {
                  input = JSON.parse(JSON.stringify(input));
                } catch {
                  input = {};
                }
              }

              block.input = input;
            }
          }

          convertedMessages.push({
            role: 'assistant',
            content: contentBlocks
          });
          continue;
        }

        // Handle assistant messages with tool calls (from OpenAI format)
        if (m.role === 'assistant' && hasToolCalls) {
          const contentBlocks: any[] = [];

          // NOTE: We previously tried to inject fake redacted_thinking blocks here for
          // thinking-enabled requests, but that fails because redacted_thinking blocks
          // require valid encrypted 'data' from actual API responses.
          // OpenAI-format messages won't have thinking blocks - that's expected.
          // The model will handle this gracefully.
          if (thinkingEnabled) {
            this.logger.debug({ messageIndex: i }, 'OpenAI-format assistant message with tool_calls - not injecting fake thinking blocks');
          }

          // Add text content if present
          if (hasContent) {
            contentBlocks.push({
              type: 'text',
              text: m.content
            });
          }

          // Add tool use blocks
          for (const toolCall of m.tool_calls) {
            // Parse the arguments and SANITIZE to ensure valid dictionary
            let input: any;
            try {
              input = JSON.parse(toolCall.function.arguments || '{}');
            } catch {
              input = {};
            }

            // CRITICAL: Ensure input is a valid plain object (dictionary)
            // Bedrock rejects requests where tool_use.input is not a plain object
            if (input === null || input === undefined) {
              input = {};
            } else if (Array.isArray(input)) {
              input = { items: input };
            } else if (typeof input !== 'object') {
              input = { value: input };
            } else {
              // Clone to ensure plain object (no prototype issues)
              try {
                input = JSON.parse(JSON.stringify(input));
              } catch {
                input = {};
              }
            }

            contentBlocks.push({
              type: 'tool_use',
              id: toolCall.id,
              name: toolCall.function.name,
              input
            });
          }

          convertedMessages.push({
            role: 'assistant',
            content: contentBlocks
          });
          continue;
        }

        // Handle tool result messages
        if (m.role === 'tool') {
          // Tool results must follow assistant messages with tool_calls
          // We need to accumulate consecutive tool messages and send them together
          const toolResults: any[] = [];
          let j = i;

          while (j < nonSystemMessages.length && nonSystemMessages[j].role === 'tool') {
            const toolMsg = nonSystemMessages[j];
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolMsg.tool_call_id,
              content: toolMsg.content || ''
            });
            j++;
          }

          // Add all tool results as a single user message
          convertedMessages.push({
            role: 'user',
            content: toolResults
          });

          // Skip the processed tool messages
          i = j - 1;
          continue;
        }

        // Handle regular user and assistant messages
        convertedMessages.push({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content || ''
        });
      }

      // Bedrock Claude doesn't allow both temperature and top_p - only use temperature
      // But top_k is always supported for Claude
      // CRITICAL: top_k must NOT be set when thinking is enabled
      // See: https://docs.claude.com/en/docs/build-with-claude/extended-thinking#important-considerations-when-using-extended-thinking
      // Note: thinkingEnabled already declared above at line ~951

      const bedrockRequest: any = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: request.max_tokens || 32768,
        temperature: request.temperature !== undefined ? request.temperature : 1.0,
        // top_p: not supported when temperature is set for Bedrock Claude
        // top_k: optional, but MUST be unset when thinking is enabled
        ...(request.top_k !== undefined && !thinkingEnabled && { top_k: request.top_k }),
        messages: convertedMessages
      };

      // =========================================================================
      // PROMPT CACHING - Cache system prompts for 75%+ cost savings
      // See: https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-caching.html
      // =========================================================================
      const enableCaching = this.config?.enablePromptCaching ??
                           process.env.AWS_BEDROCK_ENABLE_CACHING === 'true';

      if (systemMessages.length > 0) {
        const systemContent = systemMessages[0].content;
        if (enableCaching && typeof systemContent === 'string' && systemContent.length >= 1024) {
          // Add cache_control to system prompt for Claude models
          // Requires minimum 1024 tokens for Sonnet, 4096 for Opus/Haiku
          bedrockRequest.system = [
            {
              type: 'text',
              text: systemContent,
              cache_control: { type: 'ephemeral' }
            }
          ];
          this.logger.info({
            systemLength: systemContent.length,
            caching: true
          }, '💾 [BEDROCK] System prompt caching enabled');
        } else {
          bedrockRequest.system = systemContent;
        }
      }

      // Add extended thinking support for Claude (if requested via thinking parameter)
      // See: https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking
      if ((request as any).thinking?.type === 'enabled') {
        // Priority: request.thinking.budget_tokens > provider config > default
        const thinkingBudget = (request as any).thinking?.budget_tokens ||
                              (this.config as any)?.thinkingBudget ||
                              10000;
        bedrockRequest.thinking = {
          type: 'enabled',
          budget_tokens: thinkingBudget
        };
        // CRITICAL: Claude requires temperature=1 when thinking is enabled
        // https://docs.claude.com/en/docs/build-with-claude/extended-thinking#important-considerations-when-using-extended-thinking
        bedrockRequest.temperature = 1;

        // CRITICAL: max_tokens MUST be greater than thinking.budget_tokens
        // https://docs.claude.com/en/docs/build-with-claude/extended-thinking#max-tokens-and-context-window-size
        if (bedrockRequest.max_tokens <= thinkingBudget) {
          bedrockRequest.max_tokens = thinkingBudget + 4096; // Add 4096 for response tokens
        }

        // Add interleaved thinking beta header for Claude 4+ models
        // This enables thinking between tool calls and more sophisticated reasoning
        // See: https://docs.aws.amazon.com/bedrock/latest/userguide/claude-messages-extended-thinking.html
        const isClaude4Plus = modelId.includes('claude-4') ||
                              modelId.includes('claude-sonnet-4') ||
                              modelId.includes('claude-opus-4') ||
                              modelId.includes('claude-haiku-4');
        if (isClaude4Plus) {
          bedrockRequest.anthropic_beta = ['interleaved-thinking-2025-05-14'];
        }

        this.logger.info({
          modelId,
          thinking_budget: bedrockRequest.thinking.budget_tokens,
          max_tokens: bedrockRequest.max_tokens,
          temperatureOverride: 'Set to 1 (required for extended thinking)',
          interleavedThinking: isClaude4Plus
        }, '[AWSBedrockProvider] 🧠 Extended thinking enabled for Claude via Bedrock');
      }

      // DEBUG: Log tool status at entry point
      if (!request.tools || request.tools.length === 0) {
        this.logger.warn({
          modelId,
          requestKeys: Object.keys(request),
          hasMessagesArray: Array.isArray(request.messages),
          messageCount: request.messages?.length || 0,
        }, '[AWSBedrockProvider] ⚠️ NO TOOLS in request - model may generate XML tool calls instead of using native tool_use');
      }

      // Add tools if provided (Claude supports tools via Bedrock)
      if (request.tools && request.tools.length > 0) {
        bedrockRequest.tools = request.tools.map((tool: any, index: number) => {
          // #1112 — propagate `input_examples` into the tool description as
          // concrete JSON exemplars. The Anthropic Messages API (spoken by
          // Bedrock-served Claude) has no dedicated `input_examples` wire
          // field; inlining them in the description is the canonical pattern
          // so the model sees the expected input shapes at schema-prompt time.
          // Logic lives in helpers/bedrockToolExamples.ts (single SoT, tested
          // directly by AWSBedrockProvider.input-examples.test.ts).
          const toolDef: any = buildBedrockToolDef(tool, flattenTopLevelUnions);

          // Add cache_control to last tool definition for tool schema caching
          // This caches all preceding tools as a prefix
          if (enableCaching && index === request.tools!.length - 1) {
            toolDef.cache_control = { type: 'ephemeral' };
          }

          return toolDef;
        });

        if (enableCaching && request.tools.length > 0) {
          this.logger.info({
            toolCount: request.tools.length,
            caching: true
          }, '💾 [BEDROCK] Tool definitions caching enabled');
        }

        // DEBUG: Log tool configuration for troubleshooting
        this.logger.info({
          toolCount: bedrockRequest.tools.length,
          toolNames: bedrockRequest.tools.map((t: any) => t.name),
          firstToolSchema: bedrockRequest.tools[0] ? {
            name: bedrockRequest.tools[0].name,
            hasInputSchema: !!bedrockRequest.tools[0].input_schema,
            inputSchemaType: bedrockRequest.tools[0].input_schema?.type,
          } : null,
        }, '[AWSBedrockProvider] 🔧 Tools configured for request');

        // Map tool_choice to Bedrock format
        if (request.tool_choice) {
          if (request.tool_choice === 'auto') {
            bedrockRequest.tool_choice = { type: 'auto' };
          } else if (request.tool_choice === 'none') {
            bedrockRequest.tool_choice = { type: 'none' };
          } else if (typeof request.tool_choice === 'object' && request.tool_choice.function) {
            bedrockRequest.tool_choice = {
              type: 'tool',
              name: request.tool_choice.function.name
            };
          }
        } else {
          bedrockRequest.tool_choice = { type: 'auto' };
        }
      }

      return bedrockRequest;
    }

    // Amazon Titan models
    if (modelId.includes('amazon.titan')) {
      const prompt = request.messages.map(m => `${m.role}: ${m.content}`).join('\n');

      return {
        inputText: prompt,
        textGenerationConfig: {
          temperature: request.temperature || 0.7,
          topP: request.top_p || 1,
          maxTokenCount: request.max_tokens || 4096
        }
      };
    }

    // AI21 Jurassic models
    if (modelId.includes('ai21.j2')) {
      const prompt = request.messages.map(m => m.content).join('\n');

      return {
        prompt,
        temperature: request.temperature || 0.7,
        topP: request.top_p || 1,
        maxTokens: request.max_tokens || 4096
      };
    }

    // Meta Llama models
    if (modelId.includes('meta.llama')) {
      const prompt = request.messages.map(m => `${m.role}: ${m.content}`).join('\n');

      return {
        prompt,
        temperature: request.temperature || 0.7,
        top_p: request.top_p || 1,
        max_gen_len: request.max_tokens || 4096
      };
    }

    // Amazon Nova models (nova-micro, nova-lite, nova-pro)
    // Nova uses a messages format similar to Claude/OpenAI
    if (modelId.includes('amazon.nova') || modelId.includes('nova-micro') || modelId.includes('nova-lite') || modelId.includes('nova-pro')) {
      const systemMessages = request.messages.filter(m => m.role === 'system');
      const nonSystemMessages = request.messages.filter(m => m.role !== 'system');

      // Convert messages to Nova format
      const convertedMessages = nonSystemMessages.map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: [{ text: m.content || '' }]
      }));

      const novaRequest: any = {
        messages: convertedMessages,
        inferenceConfig: {
          temperature: request.temperature ?? 0.7,
          topP: request.top_p ?? 0.9,
          maxTokens: request.max_tokens || 1024
        }
      };

      // Add system prompt if present
      if (systemMessages.length > 0) {
        novaRequest.system = [{
          text: systemMessages.map(s => s.content).join('\n')
        }];
      }

      this.logger.debug({
        modelId,
        messageCount: convertedMessages.length,
        hasSystem: systemMessages.length > 0
      }, '[AWSBedrockProvider] 🚀 Nova model request');

      return novaRequest;
    }

    // Default format (works for most models)
    return {
      prompt: request.messages.map(m => m.content).join('\n'),
      temperature: request.temperature || 0.7,
      max_tokens: request.max_tokens || 4096
    };
  }

  private parseBedrockResponse(modelId: string, responseBody: any): CompletionResponse {
    // Anthropic Claude
    if (modelId.includes('anthropic.claude')) {
      const message: any = {
        role: 'assistant',
        content: ''
      };

      // Extract text content and tool calls from response
      if (responseBody.content && Array.isArray(responseBody.content)) {
        const textContent = responseBody.content
          .filter((block: any) => block.type === 'text')
          .map((block: any) => block.text)
          .join('');

        message.content = textContent || responseBody.completion || '';

        // #647 — surface Anthropic-shape `thinking` blocks (Sonnet
        // extended-thinking) so V2/codemode can render reasoning. The
        // streaming Bedrock path already emits these as thinking_delta
        // (line ~1009/1233); non-stream silently dropped them.
        const reasoningContent = responseBody.content
          .filter((block: any) => block.type === 'thinking' && typeof block.thinking === 'string')
          .map((block: any) => block.thinking)
          .join('');
        if (reasoningContent) {
          message.reasoning_content = reasoningContent;
        }

        // Extract tool calls
        const toolUseBlocks = responseBody.content.filter((block: any) => block.type === 'tool_use');
        if (toolUseBlocks.length > 0) {
          message.tool_calls = toolUseBlocks.map((block: any, index: number) => ({
            id: block.id || `call_${Date.now()}_${index}`,
            type: 'function',
            function: {
              name: block.name,
              arguments: JSON.stringify(block.input || {})
            }
          }));
        }
      } else {
        message.content = responseBody.completion || '';
      }

      return {
        id: responseBody.id || `bedrock-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{
          index: 0,
          message,
          finish_reason: responseBody.stop_reason || 'stop'
        }],
        usage: {
          prompt_tokens: responseBody.usage?.input_tokens || 0,
          completion_tokens: responseBody.usage?.output_tokens || 0,
          total_tokens: (responseBody.usage?.input_tokens || 0) + (responseBody.usage?.output_tokens || 0)
        }
      };
    }

    // Amazon Titan
    if (modelId.includes('amazon.titan')) {
      return {
        id: `bedrock-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: responseBody.results?.[0]?.outputText || ''
          },
          finish_reason: responseBody.results?.[0]?.completionReason || 'stop'
        }],
        usage: {
          prompt_tokens: responseBody.inputTextTokenCount || 0,
          completion_tokens: responseBody.results?.[0]?.tokenCount || 0,
          total_tokens: (responseBody.inputTextTokenCount || 0) + (responseBody.results?.[0]?.tokenCount || 0)
        }
      };
    }

    // Amazon Nova models
    if (modelId.includes('amazon.nova') || modelId.includes('nova-micro') || modelId.includes('nova-lite') || modelId.includes('nova-pro')) {
      // Nova response format: { output: { message: { role: "assistant", content: [{text: "..."}] } }, usage: {...} }
      const outputMessage = responseBody.output?.message;
      const content = outputMessage?.content?.[0]?.text || '';

      return {
        id: `bedrock-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content
          },
          finish_reason: responseBody.stopReason || 'end_turn'
        }],
        usage: {
          prompt_tokens: responseBody.usage?.inputTokens || 0,
          completion_tokens: responseBody.usage?.outputTokens || 0,
          total_tokens: (responseBody.usage?.inputTokens || 0) + (responseBody.usage?.outputTokens || 0)
        }
      };
    }

    // Default format
    return {
      id: `bedrock-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: responseBody.completion || responseBody.generated_text || ''
        },
        finish_reason: 'stop'
      }]
    };
  }

  private convertStreamChunk(modelId: string, chunk: any): any {
    if (modelId.includes('anthropic.claude')) {
      // INTERLEAVED THINKING: Pass through content_block_start events
      // These are critical for the UI to create separate thinking/text blocks
      if (chunk.type === 'content_block_start') {
        const blockType = chunk.content_block?.type;
        const blockIndex = chunk.index ?? 0;

        // Log at INFO level so we can see what's happening in production
        this.logger.info({
          index: blockIndex,
          blockType,
          contentBlockKeys: chunk.content_block ? Object.keys(chunk.content_block) : []
        }, '[AWSBedrockProvider] 📦 content_block_start received');

        if (blockType === 'thinking') {
          // Emit content_block_start for thinking - UI will create a thinking block
          return {
            type: 'content_block_start',
            index: blockIndex,
            content_block: { type: 'thinking' }
          };
        }

        if (blockType === 'text') {
          // Emit content_block_start for text - UI will create a text block
          return {
            type: 'content_block_start',
            index: blockIndex,
            content_block: { type: 'text' }
          };
        }

        if (blockType === 'tool_use') {
          // Emit content_block_start for tool_use
          return {
            type: 'content_block_start',
            index: blockIndex,
            content_block: {
              type: 'tool_use',
              id: chunk.content_block.id,
              name: chunk.content_block.name
            }
          };
        }

        // Handle 'signature' blocks (used for thinking verification - ignore these)
        if (blockType === 'signature') {
          this.logger.debug({ index: blockIndex }, '[AWSBedrockProvider] 🔐 Ignoring signature content_block_start');
          return null;
        }

        // FALLBACK: If we get content_block_start with unknown type, default to text
        // This prevents losing content blocks due to unrecognized types
        this.logger.warn({
          index: blockIndex,
          blockType,
          contentBlock: chunk.content_block
        }, '[AWSBedrockProvider] ⚠️ Unknown content_block type, defaulting to text');
        return {
          type: 'content_block_start',
          index: blockIndex,
          content_block: { type: 'text' }
        };
      }

      // INTERLEAVED THINKING: Pass through content_block_delta events with index
      if (chunk.type === 'content_block_delta') {
        const blockIndex = chunk.index ?? 0;
        const deltaType = chunk.delta?.type || (chunk.delta?.text ? 'text_delta' : 'unknown');

        // Handle thinking content (extended thinking from Claude via Bedrock)
        if (chunk.delta?.type === 'thinking_delta') {
          this.logger.info({
            index: blockIndex,
            deltaType: 'thinking_delta',
            contentLength: chunk.delta.thinking?.length || 0
          }, '[AWSBedrockProvider] 🧠 content_block_delta (thinking)');

          // Emit as content_block_delta with index for interleaved display
          return {
            type: 'content_block_delta',
            index: blockIndex,
            delta: {
              type: 'thinking_delta',
              thinking: chunk.delta.thinking
            }
          };
        }

        // Handle signature delta (thinking block signature for verification)
        if (chunk.delta?.type === 'signature_delta') {
          this.logger.debug({
            signatureLength: chunk.delta.signature?.length || 0
          }, '[AWSBedrockProvider] 🔐 Received thinking signature');
          return null; // Don't emit signature to frontend
        }

        // Handle text content (regular response)
        if (chunk.delta?.type === 'text_delta' || (chunk.delta?.text && !chunk.delta?.type)) {
          this.logger.info({
            index: blockIndex,
            deltaType: 'text_delta',
            contentLength: chunk.delta.text?.length || 0
          }, '[AWSBedrockProvider] 📝 content_block_delta (text)');

          // Emit as content_block_delta with index for interleaved display
          return {
            type: 'content_block_delta',
            index: blockIndex,
            delta: {
              type: 'text_delta',
              text: chunk.delta.text
            }
          };
        }

        // Handle tool use (partial function call arguments)
        if (chunk.delta?.type === 'input_json_delta' || chunk.delta?.partial_json) {
          return {
            type: 'content_block_delta',
            index: blockIndex,
            delta: {
              type: 'input_json_delta',
              partial_json: chunk.delta.partial_json || chunk.delta.input_json || ''
            }
          };
        }

        return null;
      }

      // INTERLEAVED THINKING: Pass through content_block_stop events
      // These tell the UI when a thinking/text block is complete
      if (chunk.type === 'content_block_stop') {
        const blockIndex = chunk.index ?? 0;
        this.logger.info({
          index: blockIndex
        }, '[AWSBedrockProvider] 🏁 content_block_stop');

        return {
          type: 'content_block_stop',
          index: blockIndex
        };
      }

      // Handle message_start (start of streaming)
      if (chunk.type === 'message_start') {
        return {
          id: chunk.message?.id || `bedrock-stream-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{
            index: 0,
            delta: {
              role: 'assistant'
            },
            finish_reason: null
          }]
        };
      }

      // Handle message_stop (end of streaming)
      if (chunk.type === 'message_stop') {
        return {
          id: `bedrock-stream-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: chunk.stop_reason || 'stop'
          }]
        };
      }

      // Handle message_delta (usage/metadata updates)
      if (chunk.type === 'message_delta') {
        const result: any = {
          id: `bedrock-stream-${Date.now()}`,
          object: 'chat.completion.chunk',
          created: Math.floor(Date.now() / 1000),
          model: modelId,
          choices: [{
            index: 0,
            delta: {},
            finish_reason: chunk.delta?.stop_reason || null
          }]
        };

        // Include usage if available
        if (chunk.usage) {
          result.usage = {
            prompt_tokens: chunk.usage.input_tokens || 0,
            completion_tokens: chunk.usage.output_tokens || 0,
            total_tokens: (chunk.usage.input_tokens || 0) + (chunk.usage.output_tokens || 0)
          };
        }

        return result;
      }

      // FALLBACK: Handle Amazon Nova and other models that return content differently
      // Nova models may return content in a 'generation' field or other format
      if (chunk.generation || chunk.outputText || chunk.output?.text || chunk.content) {
        const textContent = chunk.generation || chunk.outputText || chunk.output?.text ||
                           (typeof chunk.content === 'string' ? chunk.content : null);
        if (textContent) {
          this.logger.debug({
            contentLength: textContent.length,
            source: chunk.generation ? 'generation' : chunk.outputText ? 'outputText' : 'content'
          }, '[AWSBedrockProvider] 📝 Extracted text from non-Anthropic format');

          return {
            id: `bedrock-stream-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: modelId,
            choices: [{
              index: 0,
              delta: {
                content: textContent
              },
              finish_reason: null
            }]
          };
        }
      }

      // Log unhandled chunk types for debugging
      this.logger.warn({
        chunkType: chunk.type,
        chunkKeys: Object.keys(chunk),
        modelId
      }, '[AWSBedrockProvider] ⚠️ Unhandled chunk type');

    }

    // For non-Claude models, try to extract content from various fields
    if (chunk.generation || chunk.outputText || chunk.output?.text) {
      const textContent = chunk.generation || chunk.outputText || chunk.output?.text;
      return {
        id: `bedrock-stream-${Date.now()}`,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{
          index: 0,
          delta: {
            content: textContent
          },
          finish_reason: null
        }]
      };
    }

    return null;
  }

  async listModels(): Promise<Array<{ id: string; name: string; provider: string }>> {
    if (!this.initialized || !this.bedrockClient) {
      throw new Error('AWS Bedrock provider not initialized');
    }

    // DB-only: return models from provider_config.models + config model fields
    const models: Array<{ id: string; name: string; provider: string }> = [];
    const addedModels = new Set<string>();

    // Helper to add model if not already added
    const addModel = (modelId: string | undefined) => {
      if (!modelId || addedModels.has(modelId)) return;
      addedModels.add(modelId);
      models.push({ id: modelId, name: modelId, provider: 'aws-bedrock' });
    };

    // Add models from DB config fields (set during initialize from ProviderConfigService)
    addModel(this.config?.chatModel || this.config?.modelId);
    addModel(this.config?.embeddingModel);
    addModel(this.config?.visionModel);
    addModel(this.config?.imageModel);
    addModel(this.config?.compactionModel);

    // Add database-configured models array (from admin API / provider_config.models)
    const dbConfiguredModels = (this.config as any)?.models as any[];
    if (Array.isArray(dbConfiguredModels)) {
      for (const dbModel of dbConfiguredModels) {
        if (dbModel.id && !addedModels.has(dbModel.id)) {
          addedModels.add(dbModel.id);
          models.push({
            id: dbModel.id,
            name: dbModel.name || dbModel.id,
            provider: 'aws-bedrock',
          } as any);
        }
      }
    }

    this.logger.info({
      modelCount: models.length,
      models: models.map(m => m.id),
    }, '[AWSBedrockProvider] Listed models from DB config');

    return models;
  }

  /**
   * Get detailed model information from AWS Bedrock API using GetFoundationModelCommand.
   * Returns provider defaults for the model. Results NOT cached — call sparingly.
   */
  async getModelDefaults(modelId: string): Promise<Partial<import('./ILLMProvider.js').ProviderDefaultConfig> | null> {
    if (!this.initialized || !this.bedrockClient) {
      return null;
    }

    try {
      // Strip cross-region prefix for API call (e.g., us.anthropic.claude-... → anthropic.claude-...)
      const baseModelId = modelId.replace(/^(us|eu|apac)\./, '');
      const command = new GetFoundationModelCommand({ modelIdentifier: baseModelId });
      const response = await this.bedrockClient.send(command);
      const details = response.modelDetails;

      if (!details) {
        this.logger.warn({ modelId }, '[AWSBedrockProvider] GetFoundationModel returned no details');
        return null;
      }

      this.logger.debug({
        modelId: details.modelId,
        modelName: details.modelName,
        providerName: details.providerName,
        inputModalities: details.inputModalities,
        outputModalities: details.outputModalities,
        streaming: details.responseStreamingSupported,
        inferenceTypes: details.inferenceTypesSupported
      }, '[AWSBedrockProvider] Retrieved model details');

      const result: Partial<import('./ILLMProvider.js').ProviderDefaultConfig> = {};
      const providerName = details.providerName?.toLowerCase() || '';

      if (providerName === 'anthropic') {
        result.supportsTopK = true;
        result.supportsFreqPenalty = false;
        result.supportsThinking = true;
        result.thinkingMode = 'budget';
        result.temperature = 1.0;
        result.topP = 0.999;
        result.topK = 40;
        result.maxTokens = 8192;
        result.extendedThinkingEnabled = true;
        result.thinkingBudget = 10000;
        result.temperatureRange = [0, 1];
        result.maxTokensRange = [256, 128000];
        result.topKRange = [1, 500];
      } else if (providerName === 'meta') {
        result.supportsTopK = true;
        result.supportsThinking = false;
        result.temperature = 0.7;
        result.topP = 0.9;
        result.maxTokens = 4096;
        result.temperatureRange = [0, 1];
        result.maxTokensRange = [256, 131072];
      } else if (providerName === 'amazon') {
        result.supportsThinking = false;
        result.temperature = 0.7;
        result.topP = 0.9;
        result.maxTokens = 4096;
        result.temperatureRange = [0, 1];
        result.maxTokensRange = [256, 8192];
      } else if (providerName.includes('mistral')) {
        result.supportsThinking = false;
        result.temperature = 0.7;
        result.topP = 1.0;
        result.maxTokens = 8192;
        result.temperatureRange = [0, 1];
        result.maxTokensRange = [256, 8192];
      }

      // Store extra info for UI display
      (result as any).modelName = details.modelName;
      (result as any).providerName = details.providerName;
      (result as any).inputModalities = details.inputModalities;
      (result as any).outputModalities = details.outputModalities;
      (result as any).inferenceTypesSupported = details.inferenceTypesSupported;
      (result as any).responseStreamingSupported = details.responseStreamingSupported;

      return result;
    } catch (err: any) {
      this.logger.warn({ modelId, error: err.message }, '[AWSBedrockProvider] Failed to get model defaults');
      return null;
    }
  }

  /**
   * #650 — Live provider-pulled model details. Used by the Add-Model
   * route + daily refresh cron to populate every Registry column from
   * the SDK rather than the request body or static defaults.
   *
   * Pipeline:
   *   1. GetFoundationModel — modality + streaming + provider name
   *   2. inferBedrockFamilyAndLimits — family + tools/thinking/limits
   *      from the admin-editable table (SDK silent on these fields)
   *   3. BedrockPricingFetcher — USD rates from @aws-sdk/client-pricing
   *
   * Test injects `bedrockClient` + `injectedPricingFetcher` so the
   * suite runs offline; real SDK clients are integration-tested
   * separately when AWS_PRICING_INTEGRATION=1.
   */
  async discoverModelDetails(
    modelId: string,
    region?: string,
  ): Promise<import('./discovery/ModelDiscoveryRecord.js').ModelDiscoveryRecord | null> {
    if (!this.initialized || !this.bedrockClient) {
      throw new Error('[AWSBedrockProvider] not initialized');
    }
    const inferenceRegion = region ?? (this.config?.region as string | undefined) ?? 'us-east-1';

    // 1. GetFoundationModel — capabilities source.
    const baseModelId = modelId.replace(/^(us|eu|apac)\./, '');
    const fmResp = await this.bedrockClient.send(
      new GetFoundationModelCommand({ modelIdentifier: baseModelId }),
    );
    const details = fmResp.modelDetails;
    if (!details) {
      throw new Error(
        `[AWSBedrockProvider] GetFoundationModel returned no details for ${modelId}`,
      );
    }

    // 2. Family + table-driven flags (tools/thinking/limits — Bedrock SDK
    //    does NOT return these; consult the admin-editable inference table).
    const { inferBedrockFamilyAndLimits } = await import('./BedrockCapabilityInference.js');
    const inferred = inferBedrockFamilyAndLimits(details);

    // 3. Pricing — delegate to BedrockPricingFetcher (#342 already shipped).
    //    Tests inject `injectedPricingFetcher` so the suite runs offline.
    const fetcher =
      (this as any).injectedPricingFetcher ??
      (await import('../pricing/BedrockPricingFetcher.js').then(
        (m) => new m.BedrockPricingFetcher(),
      ));
    // Mirror GoogleVertexProvider — degrade gracefully when pricing creds
    // aren't available so capabilities + limits still populate. Live-verify
    // on the dev environment surfaced this: Sonnet refresh returned 502 because the
    // Pricing API client couldn't resolve AWS creds, even though the model
    // exists and its limits ARE known from the family table.
    let pricing: any = {
      source: 'bedrock-pricing-sdk',
      fetchedAt: new Date().toISOString(),
    };
    try {
      pricing = await fetcher.fetch({ modelId, region: inferenceRegion });
    } catch (err) {
      this.logger.warn(
        { modelId, err: (err as Error).message },
        '[AWSBedrockProvider] pricing fetch failed — leaving null',
      );
    }

    return {
      modelId,
      providerType: 'aws-bedrock',
      displayName: details.modelName ?? modelId,
      family: inferred.family,
      capabilities: {
        chat: !inferred.isEmbedding,
        vision: (details.inputModalities ?? []).includes('IMAGE'),
        tools: inferred.supportsTools,
        thinking: inferred.supportsThinking,
        embeddings: inferred.isEmbedding,
        imageGeneration: (details.outputModalities ?? []).includes('IMAGE'),
        streaming: !!details.responseStreamingSupported,
        nativeToolCalling: inferred.nativeToolCalling,
      },
      contextWindow: inferred.contextWindow,
      maxOutputTokens: inferred.maxOutputTokens,
      thinkingBudget: inferred.thinkingBudget,
      temperature: inferred.temperature,
      topP: inferred.topP,
      topK: inferred.topK,
      pricing: {
        inputTokenUsd: pricing.inputTokenUsd ?? null,
        outputTokenUsd: pricing.outputTokenUsd ?? null,
        cacheReadUsd: pricing.cacheReadUsd ?? null,
        cacheWriteUsd: pricing.cacheWriteUsd ?? null,
        thinkingTokenUsd: pricing.thinkingTokenUsd ?? null,
        embeddingTokenUsd: pricing.embeddingTokenUsd ?? null,
        perRequestUsd: pricing.imageGenPerRequestUsd ?? null,
        source: pricing.source as any,
        fetchedAt: pricing.fetchedAt,
        region: inferenceRegion,
      },
    };
  }

  /**
   * Generate text embeddings using Amazon Titan Embedding models
   */
  async embedText(
    text: string | string[],
    callerContext?: BedrockCallerContext,
  ): Promise<number[] | number[][]> {
    if (!this.initialized || !this.runtimeClient) {
      throw new Error('AWS Bedrock provider not initialized');
    }

    const embeddingModel = process.env.AWS_BEDROCK_EMBEDDING_MODEL || process.env.EMBEDDING_MODEL;
    if (!embeddingModel) {
      throw new Error('AWS Bedrock embedding model not configured (AWS_BEDROCK_EMBEDDING_MODEL)');
    }
    const texts = Array.isArray(text) ? text : [text];
    const embeddings: number[][] = [];

    // Build client once per call so a token exchange is not repeated per chunk.
    const client = await this.getBedrockClient(callerContext);

    for (const inputText of texts) {
      // Prepare request body for Titan embedding model
      const body = {
        inputText: inputText,
        dimensions: parseInt(process.env.AWS_BEDROCK_EMBEDDING_DIMENSION || process.env.EMBEDDING_DIMENSION || '1024'),
        normalize: true
      };

      const command = new InvokeModelCommand({
        modelId: embeddingModel,
        body: JSON.stringify(body),
        contentType: 'application/json',
        accept: 'application/json'
      });

      try {
        const response = await client.send(command);
        const responseBody = JSON.parse(new TextDecoder().decode(response.body));

        // Titan returns: { embedding: number[], inputTextTokenCount: number }
        if (responseBody.embedding && Array.isArray(responseBody.embedding)) {
          embeddings.push(responseBody.embedding);
        } else {
          throw new Error('Invalid embedding response from Titan model');
        }
      } catch (error) {
        this.logger.error({
          error: error instanceof Error ? error.message : error,
          model: embeddingModel,
          textLength: inputText.length
        }, 'Failed to generate embedding');
        throw error;
      }
    }

    // Return single array if input was string, array of arrays if input was array
    return Array.isArray(text) ? embeddings : embeddings[0];
  }

  async getHealth(): Promise<ProviderHealth> {
    if (!this.initialized || !this.bedrockClient) {
      return {
        status: 'not_initialized',
        provider: this.name,
        lastChecked: new Date()
      };
    }

    try {
      // Simple health check - list models
      await this.bedrockClient.send(new ListFoundationModelsCommand({}));

      return {
        status: 'healthy',
        provider: this.name,
        endpoint: this.config?.endpoint,
        lastChecked: new Date()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        provider: this.name,
        endpoint: this.config?.endpoint,
        error: error instanceof Error ? error.message : String(error),
        lastChecked: new Date()
      };
    }
  }

  private estimateCost(modelId: string, tokens: number): number {
    // Cost tracking is handled centrally by LLMMetricsService
    // Return 0 here - actual costs are calculated and stored when logging metrics
    return 0;
  }

  /**
   * Discover models available from AWS Bedrock.
   * Tries live API discovery first (ListFoundationModels), falls back to hardcoded catalog.
   */
  async discoverModels(): Promise<DiscoveredModel[]> {
    // Build set of already-configured model IDs for marking
    const configuredIds = new Set<string>();
    try {
      const existing = await this.listModels();
      for (const m of existing) configuredIds.add(m.id);
    } catch { /* ignore */ }

    let models: DiscoveredModel[];

    // Try live discovery from AWS API
    try {
      if (!this.initialized || !this.bedrockClient) {
        throw new Error('Bedrock client not initialized');
      }

      // Check cache first
      const now = Date.now();
      if (this.foundationModelCache && (now - this.foundationModelCache.timestamp) < AWSBedrockProvider.MODEL_CACHE_TTL_MS) {
        this.logger.debug('Using cached foundation model list');
      } else {
        const command = new ListFoundationModelsCommand({});
        const response = await this.bedrockClient.send(command);
        this.foundationModelCache = {
          models: response.modelSummaries || [],
          timestamp: now,
        };
        this.logger.info({ count: this.foundationModelCache.models.length }, '[AWSBedrockProvider] Fetched live foundation models from AWS');
      }

      // Foundation models eligible for discovery: keep ON_DEMAND + non-LEGACY,
      // and surface chat/embedding/image-gen modalities. INFERENCE_PROFILE-only
      // entries are surfaced below via the inference-profile merge.
      const foundationModels: DiscoveredModel[] = [];
      for (const m of this.foundationModelCache.models as any[]) {
        const inferenceTypes = m.inferenceTypesSupported || [];
        if (!inferenceTypes.includes('ON_DEMAND')) continue;
        if (m.modelLifecycle?.status === 'LEGACY') continue;
        const outputModalities = m.outputModalities || [];
        if (
          !outputModalities.includes('TEXT') &&
          !outputModalities.includes('EMBEDDING') &&
          !outputModalities.includes('IMAGE')
        )
          continue;
        const discovered = bedrockSummaryToDiscoveredModel(m);
        if (discovered) foundationModels.push(discovered);
      }
      models = foundationModels;

      this.logger.info(
        { discoveredCount: models.length },
        '[AWSBedrockProvider] Live foundation-model discovery complete',
      );
    } catch (err: any) {
      this.logger.error(
        { error: err.message },
        '[AWSBedrockProvider] Live foundation-model discovery failed',
      );
      models = [];
    }

    // Sev-2 (2026-04-19): merge cross-region inference profiles so Claude 4.x
    // and every other INFERENCE_PROFILE-only model appears in Add-Model.
    // Capability inference comes from the underlying foundation model's API
    // modality fields via BedrockCapabilityInference (no name matching).
    try {
      if (this.initialized && this.bedrockClient) {
        const ancestorIndex = indexFoundationSummaries(
          (this.foundationModelCache?.models || []) as any[],
        );
        const profileResp = await this.bedrockClient.send(
          new ListInferenceProfilesCommand({ typeEquals: 'SYSTEM_DEFINED' }),
        );
        const profiles = profileResp.inferenceProfileSummaries || [];
        const existingIds = new Set(models.map((m) => m.id));
        let added = 0;
        for (const p of profiles as any[]) {
          const discovered = bedrockInferenceProfileToDiscoveredModel(
            p,
            ancestorIndex,
          );
          if (!discovered) continue;
          if (existingIds.has(discovered.id)) continue;
          models.push(discovered);
          existingIds.add(discovered.id);
          added += 1;
        }
        if (added > 0) {
          this.logger.info(
            {
              profilesAdded: added,
              totalAfterMerge: models.length,
            },
            '[AWSBedrockProvider] Merged inference profiles into discovery',
          );
        }
      }
    } catch (err: any) {
      // Older deployments may lack bedrock:ListInferenceProfiles in the
      // IAM policy. Don't fail the whole discovery — continue with
      // whatever foundation models we already have.
      this.logger.warn(
        { error: err.message },
        '[AWSBedrockProvider] Inference-profile discovery failed — continuing with foundation models only',
      );
    }

    // Mark configured models
    for (const model of models) {
      model.configured = configuredIds.has(model.id);
    }

    return models;
  }

  /**
   * Infer context window from model ID pattern
   */
  private inferContextWindow(modelId: string): number {
    if (modelId.includes('claude-opus-4-6') || modelId.includes('claude-sonnet-4-6')) return 200000;
    if (modelId.includes('claude') && modelId.includes('4-5')) return 200000;
    if (modelId.includes('claude-3-7')) return 200000;
    if (modelId.includes('claude-3-5')) return 200000;
    if (modelId.includes('claude-3')) return 200000;
    if (modelId.includes('nova-pro') || modelId.includes('nova-lite')) return 300000;
    if (modelId.includes('nova-micro')) return 128000;
    if (modelId.includes('llama-3')) return 128000;
    if (modelId.includes('mistral')) return 32000;
    return 128000;
  }

  /**
   * Infer max output tokens from model ID pattern
   */
  private inferMaxOutputTokens(modelId: string): number {
    if (modelId.includes('claude-opus-4-6') || modelId.includes('claude-sonnet-4-6')) return 128000;
    if (modelId.includes('claude') && modelId.includes('4-5')) return 128000;
    if (modelId.includes('claude') && (modelId.includes('4-1') || modelId.includes('4-20'))) return 128000;
    // Opus 4.7 / 4.8 (and any future 4.7+/4.8+) — 128K output, matching the
    // ModelCapabilityRegistry rows for these ids. Without this they fell
    // through to the 8192 catch-all below, became the wire modelOutputCap
    // floor, and TRUNCATED large artifacts (Bedrock stop_reason:max_tokens).
    // #cap-sync 2026-06-16. (Upstream additionally consults the registry first;
    // we keep this pattern table authoritative — the registry row and this line
    // both return 128000, so they agree, and the table needs no live registry.)
    if (modelId.includes('claude') && (modelId.includes('4-7') || modelId.includes('4-8'))) return 128000;
    if (modelId.includes('claude-3-7')) return 128000;
    if (modelId.includes('claude-3-5')) return 8192;
    if (modelId.includes('claude-3')) return 4096;
    if (modelId.includes('nova')) return 5120;
    if (modelId.includes('llama-3')) return 4096;
    return 8192;
  }

  /**
   * Provider-level defaults — reflects Bedrock Claude defaults.
   */
  static getDefaultConfig(): import('./ILLMProvider.js').ProviderDefaultConfig {
    return {
      maxTokens: 8192, temperature: 1.0, topP: 0.999, topK: 40,
      frequencyPenalty: 0, presencePenalty: 0,
      extendedThinkingEnabled: true, thinkingBudget: 10000, thinkingLevel: '',
      supportsTopK: true, supportsFreqPenalty: false, supportsThinking: true,
      thinkingMode: 'budget',
      temperatureRange: [0, 1], maxTokensRange: [256, 128000], topKRange: [1, 500],
      defaultChatModel: 'us.anthropic.claude-sonnet-4-6', defaultEmbeddingModel: '',
    };
  }

  /**
   * Generate an image using AWS Bedrock (Nova Canvas, Titan Image, Stability AI).
   * Request format auto-detected from model ID.
   */
  async generateImage(
    request: import('./ILLMProvider.js').ImageGenerationRequest,
    callerContext?: BedrockCallerContext,
  ): Promise<import('./ILLMProvider.js').ImageGenerationResponse> {
    if (!this.initialized || !this.runtimeClient) {
      throw new Error('[AWSBedrockProvider] Not initialized — cannot generate image');
    }

    const startTime = Date.now();
    const model = request.model || process.env.AWS_IMAGE_MODEL || 'amazon.nova-canvas-v1:0';
    const [width, height] = (request.size || '1024x1024').split('x').map(Number);

    // Detect request format from model ID
    const modelLower = model.toLowerCase();
    let body: Record<string, unknown>;
    if (modelLower.includes('stability') || modelLower.includes('stable-diffusion')) {
      body = {
        text_prompts: [{ text: request.prompt, weight: 1.0 }],
        cfg_scale: 7,
        steps: 50,
        width: width || 1024,
        height: height || 1024,
        samples: request.n || 1,
      };
    } else {
      // Amazon format (Nova Canvas, Titan Image)
      body = {
        taskType: 'TEXT_IMAGE',
        textToImageParams: { text: request.prompt },
        imageGenerationConfig: {
          numberOfImages: request.n || 1,
          quality: 'standard',
          width: width || 1024,
          height: height || 1024,
        },
      };
    }

    const command = new InvokeModelCommand({
      modelId: model,
      body: JSON.stringify(body),
      contentType: 'application/json',
      accept: 'application/json',
    });

    const client = await this.getBedrockClient(callerContext);
    const response = await client.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    const generationTimeMs = Date.now() - startTime;

    // Extract base64 from response (format depends on model)
    const imageBase64 = responseBody.images?.[0]
      || responseBody.artifacts?.[0]?.base64
      || responseBody.image;

    if (!imageBase64) {
      throw new Error(`[AWSBedrockProvider] No image data in Bedrock response for model ${model}`);
    }

    this.logger.info({ model, generationTimeMs }, '[AWSBedrockProvider] Image generated successfully');

    return {
      imageBase64,
      revisedPrompt: request.prompt,
      model,
      provider: this.name,
      format: 'png',
      generationTimeMs,
    };
  }
}

// ---------------------------------------------------------------------------
// Exported normalizer — testable without instantiating the provider
// ---------------------------------------------------------------------------

