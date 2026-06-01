/**
 * LLM Provider Management — Types, constants, and shared styles.
 */
import React from 'react';
import {
  AzureIcon, AzureAIIcon, VertexAIIcon, AWSIcon, OllamaIcon, AnthropicIcon, OpenAIIcon,
} from '../../Shared/ProviderIcons';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type ProviderType = 'azure-openai' | 'azure-ai-foundry' | 'vertex-ai' | 'aws-bedrock' | 'ollama' | 'anthropic' | 'openai';
export type ViewMode = 'cards' | 'matrix';
export type HealthStatus = 'healthy' | 'unhealthy' | 'not_initialized' | 'unknown' | 'paused' | 'disabled';

export interface ProviderDefaultConfig {
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
  frequencyPenalty: number;
  presencePenalty: number;
  extendedThinkingEnabled: boolean;
  thinkingBudget: number;
  thinkingLevel: string;
  supportsTopK: boolean;
  supportsFreqPenalty: boolean;
  supportsThinking: boolean;
  thinkingMode: 'budget' | 'level';
  temperatureRange: [number, number];
  maxTokensRange: [number, number];
  topKRange: [number, number];
  defaultChatModel: string;
  defaultEmbeddingModel: string;
}

export const FALLBACK_DEFAULTS: ProviderDefaultConfig = {
  maxTokens: 8192, temperature: 1.0, topP: 1.0, topK: 40,
  frequencyPenalty: 0, presencePenalty: 0,
  extendedThinkingEnabled: false, thinkingBudget: 8000, thinkingLevel: 'high',
  supportsTopK: false, supportsFreqPenalty: false, supportsThinking: false,
  thinkingMode: 'budget', temperatureRange: [0, 2], maxTokensRange: [256, 128000],
  topKRange: [0, 0], defaultChatModel: '', defaultEmbeddingModel: '',
};

export interface DbProvider {
  id: string;
  name: string;
  display_name: string;
  provider_type: ProviderType;
  enabled: boolean;
  priority: number;
  description?: string;
  auth_config: Record<string, any>;
  provider_config: Record<string, any>;
  model_config: Record<string, any>;
  capabilities: Record<string, boolean>;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
  /** §11.5 optimistic concurrency token. POST this back on PUT
   *  so the server can detect concurrent saves and 409 instead of
   *  silently clobbering. */
  version?: number;
  updated_by?: string | null;
}

export interface HealthInfo {
  provider: string;
  status: 'healthy' | 'unhealthy' | 'not_initialized';
  endpoint?: string;
  error?: string;
  lastChecked: string;
}

export interface MetricsInfo {
  provider: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  averageLatency: number;
  totalTokens: number;
  totalCost: number;
}

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export const CAPABILITY_ROWS = [
  { key: 'chat', label: 'Chat', description: 'Text generation and conversation' },
  { key: 'embeddings', label: 'Embedding', description: 'Vector embeddings for semantic search' },
  { key: 'vision', label: 'Vision', description: 'Image understanding and analysis' },
  { key: 'image_generation', label: 'Image Generation', description: 'Generate images from text' },
  { key: 'compaction', label: 'Compaction', description: 'Context window summarization' },
] as const;

export const PAUSE_DURATIONS = [
  { value: 15, label: '15 min' },
  { value: 60, label: '1 hour' },
  { value: 240, label: '4 hours' },
  { value: 1440, label: '24 hours' },
] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// PROVIDER METADATA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * (#70) Provider config field — non-credential SDK-exposed settings.
 * Rendered in the "Provider Settings" section of the edit form, separate
 * from authFields (credentials) and basic fields (name/description/etc).
 *
 * Field types:
 *   text     — single-line input
 *   password — masked single-line input
 *   textarea — multi-line input
 *   number   — numeric input with min/max
 *   toggle   — boolean checkbox
 *   select   — dropdown with fixed options
 */
export type ProviderConfigField = {
  key: string;
  label: string;
  type: 'text' | 'password' | 'textarea' | 'number' | 'toggle' | 'select';
  required?: boolean;
  placeholder?: string;
  help?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
  default?: any;
};

/**
 * Auth-field shape used by both the legacy single-mode `authFields` and
 * the multi-mode `authModes` map (azure-* providers).
 */
export type AuthFieldDef = {
  key: string;
  label: string;
  type: 'text' | 'password' | 'textarea';
  required?: boolean;
  placeholder?: string;
};

/**
 * Multi-mode auth schema. When defined on a provider's META entry, the
 * Add/Edit form renders a radio toggle (api-key | entra-id) and swaps
 * the rendered field set per selection. azure-ai-foundry and
 * azure-openai use this shape so admins can pick API Key OR Entra-ID
 * (AAD app reg with tenantId/clientId/clientSecret) — the original
 * Entra-only deploy pattern was unreachable through the form before
 * this 2026-05-01 fix.
 */
export type AuthMode = 'api-key' | 'entra-id';

export const PROVIDER_META: Record<ProviderType, {
  label: string;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  borderColor: string;
  description: string;
  authFields: Array<AuthFieldDef>;
  /** Multi-mode auth (azure-*). When present, takes precedence over `authFields`. */
  authModes?: Partial<Record<AuthMode, Array<AuthFieldDef>>>;
  /** (#70) Per-provider SDK-exposed configuration knobs. */
  providerConfigFields?: ProviderConfigField[];
}> = {
  'azure-openai': {
    label: 'Azure OpenAI', icon: <AzureIcon size={20} />, color: 'var(--provider-azure)',
    bgColor: 'bg-[color-mix(in_srgb,var(--color-nfo)_10%,transparent)]', borderColor: 'border-[color-mix(in_srgb,var(--color-nfo)_30%,transparent)]',
    description: 'Microsoft Azure hosted GPT models',
    // Legacy single-mode `authFields` kept as a fallback for non-azure consumers
    // and tests that read the union; the form uses `authModes` when present.
    authFields: [
      { key: 'endpoint', label: 'Endpoint URL', type: 'text', required: true, placeholder: 'https://your-resource.openai.azure.com' },
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
      { key: 'deploymentName', label: 'Deployment Name', type: 'text', required: true },
      { key: 'apiVersion', label: 'API Version', type: 'text', placeholder: '2024-08-01-preview' },
    ],
    authModes: {
      'api-key': [
        { key: 'endpoint', label: 'Endpoint URL', type: 'text', required: true, placeholder: 'https://your-resource.openai.azure.com' },
        { key: 'apiKey', label: 'API Key', type: 'password', required: true },
        { key: 'deploymentName', label: 'Deployment Name', type: 'text', required: true },
        { key: 'apiVersion', label: 'API Version', type: 'text', placeholder: '2024-08-01-preview' },
      ],
      'entra-id': [
        { key: 'endpoint', label: 'Endpoint URL', type: 'text', required: true, placeholder: 'https://your-resource.openai.azure.com' },
        { key: 'tenantId', label: 'Tenant ID', type: 'text', required: true, placeholder: 'aad tenant guid' },
        { key: 'clientId', label: 'Client ID', type: 'text', required: true, placeholder: 'app registration appId' },
        { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true, placeholder: 'app registration secret' },
        { key: 'deploymentName', label: 'Deployment Name', type: 'text', required: true },
        { key: 'apiVersion', label: 'API Version', type: 'text', placeholder: '2024-08-01-preview' },
      ],
    },
  },
  'azure-ai-foundry': {
    label: 'Azure AI Foundry', icon: <AzureAIIcon size={20} />, color: 'var(--provider-azure)',
    bgColor: 'bg-[color-mix(in_srgb,var(--color-nfo)_10%,transparent)]', borderColor: 'border-[color-mix(in_srgb,var(--color-nfo)_30%,transparent)]',
    description: 'Azure AI Foundry unified model router',
    authFields: [
      { key: 'endpoint', label: 'Endpoint URL', type: 'text', required: true, placeholder: 'https://your-foundry.services.ai.azure.com' },
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
      { key: 'deploymentName', label: 'Deployment Name', type: 'text', placeholder: 'model-router (only used in deployment mode)' },
      { key: 'apiVersion', label: 'API Version', type: 'text', placeholder: '2024-08-01-preview' },
    ],
    authModes: {
      'api-key': [
        { key: 'endpoint', label: 'Endpoint URL', type: 'text', required: true, placeholder: 'https://your-foundry.services.ai.azure.com' },
        { key: 'apiKey', label: 'API Key', type: 'password', required: true },
        { key: 'deploymentName', label: 'Deployment Name', type: 'text', placeholder: 'model-router (only used in deployment mode)' },
        { key: 'apiVersion', label: 'API Version', type: 'text', placeholder: '2024-08-01-preview' },
      ],
      'entra-id': [
        { key: 'endpoint', label: 'Endpoint URL', type: 'text', required: true, placeholder: 'https://your-foundry.services.ai.azure.com' },
        { key: 'tenantId', label: 'Tenant ID', type: 'text', required: true, placeholder: 'aad tenant guid' },
        { key: 'clientId', label: 'Client ID', type: 'text', required: true, placeholder: 'app registration appId' },
        { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true, placeholder: 'app registration secret' },
        { key: 'deploymentName', label: 'Deployment Name', type: 'text', placeholder: 'model-router (only used in deployment mode)' },
        { key: 'apiVersion', label: 'API Version', type: 'text', placeholder: '2024-08-01-preview' },
      ],
    },
    // (#70) AIF-specific provider settings — exposes SDK features that
    // don't fit in the auth/credential model.
    providerConfigFields: [
      {
        key: 'useUnifiedEndpoint',
        label: 'Use Unified Foundry Endpoint',
        type: 'toggle',
        default: false,
        help: 'When enabled, calls /models/chat/completions and passes model name in body. Lets you use ANY catalog model (Claude, Mistral, Llama) without per-model deployments. Required marketplace subscription is a one-time terms accept in Azure portal.',
      },
      {
        key: 'contentFilterLevel',
        label: 'Content Filter Level',
        type: 'select',
        default: 'medium',
        options: [
          { value: 'low', label: 'Low (permissive)' },
          { value: 'medium', label: 'Medium (default)' },
          { value: 'high', label: 'High (strict)' },
        ],
        help: 'Azure content filter strictness. Per-deployment override available in Azure portal.',
      },
    ],
  },
  'vertex-ai': {
    label: 'Google Vertex AI', icon: <VertexAIIcon size={20} />, color: 'var(--provider-google)',
    bgColor: 'bg-[color-mix(in_srgb,var(--color-err)_10%,transparent)]', borderColor: 'border-[color-mix(in_srgb,var(--color-err)_30%,transparent)]',
    description: 'Google Cloud Gemini models',
    authFields: [
      { key: 'projectId', label: 'GCP Project ID', type: 'text', required: true },
      { key: 'region', label: 'Region', type: 'text', placeholder: 'us-central1' },
      { key: 'serviceAccountCredentials', label: 'Service Account JSON', type: 'textarea', placeholder: 'Paste service account JSON' },
    ],
    providerConfigFields: [
      {
        key: 'globalEndpoint',
        label: 'Use Global Endpoint',
        type: 'toggle',
        default: false,
        help: 'Route to Vertex AI global endpoint (auto-region selection) instead of the configured region. Recommended for production traffic.',
      },
      {
        key: 'safetySettings',
        label: 'Default Safety Settings',
        type: 'select',
        default: 'default',
        options: [
          { value: 'default', label: 'Default (block-medium)' },
          { value: 'block-low', label: 'Block low and above (most strict)' },
          { value: 'block-high', label: 'Block only high (least strict)' },
          { value: 'block-none', label: 'Block none (off — admin only)' },
        ],
        help: 'Per-request override via safety_settings parameter. block-none requires Vertex AI Safety waiver.',
      },
    ],
  },
  'aws-bedrock': {
    label: 'AWS Bedrock', icon: <AWSIcon size={20} />, color: 'var(--provider-aws)',
    bgColor: 'bg-[color-mix(in_srgb,var(--color-warn)_10%,transparent)]', borderColor: 'border-[color-mix(in_srgb,var(--color-warn)_30%,transparent)]',
    description: 'Amazon hosted Claude, Llama, Titan models',
    authFields: [
      { key: 'region', label: 'AWS Region', type: 'text', required: true, placeholder: 'us-east-1' },
      { key: 'awsAccessKeyId', label: 'Access Key ID', type: 'password' },
      { key: 'awsSecretAccessKey', label: 'Secret Access Key', type: 'password' },
    ],
    providerConfigFields: [
      {
        key: 'endpoint',
        label: 'Endpoint URL (optional)',
        type: 'text',
        placeholder: 'https://bedrock-runtime.us-east-1.amazonaws.com or https://vpce-xxxx.bedrock-runtime.us-east-1.vpce.amazonaws.com',
        help: 'Override the default AWS Bedrock endpoint — use for VPC endpoint / AWS PrivateLink, FIPS endpoint (https://bedrock-runtime-fips.<region>.amazonaws.com), or a custom proxy. Leave blank to use the public AWS endpoint for the configured region.',
      },
      {
        key: 'crossRegionInference',
        label: 'Cross-Region Inference',
        type: 'toggle',
        default: true,
        help: 'Use Bedrock inference profiles (us. eu. apac. prefixes) so Claude/Llama route to whichever region has capacity. Reduces throttling significantly.',
      },
      {
        key: 'guardrailsId',
        label: 'Guardrails ID (optional)',
        type: 'text',
        placeholder: 'e.g. arn:aws:bedrock:us-east-1:..../guardrail/abc123',
        help: 'Apply a Bedrock Guardrails policy to all requests routed through this provider.',
      },
      {
        key: 'invocationLogging',
        label: 'Enable Invocation Logging',
        type: 'toggle',
        default: false,
        help: 'Send model input/output to CloudWatch via Bedrock model invocation logging. Requires the IAM role to allow logs:PutLogEvents.',
      },
    ],
  },
  ollama: {
    label: 'Ollama', icon: <OllamaIcon size={20} />, color: 'var(--provider-ollama)',
    bgColor: 'bg-[color-mix(in_srgb,var(--color-ok)_10%,transparent)]', borderColor: 'border-[color-mix(in_srgb,var(--color-ok)_30%,transparent)]',
    description: 'Self-hosted open source models',
    authFields: [
      { key: 'endpoint', label: 'Endpoint URL', type: 'text', required: true, placeholder: 'http://ollama:11434' },
    ],
    providerConfigFields: [
      {
        key: 'numGpu',
        label: 'GPU Layers (num_gpu)',
        type: 'number',
        min: 0,
        max: 999,
        default: 0,
        help: '0 = CPU only. 999 = offload all layers to GPU. Models larger than VRAM will fall back to CPU automatically.',
      },
      {
        key: 'numThread',
        label: 'CPU Threads',
        type: 'number',
        min: 0,
        max: 256,
        default: 0,
        help: '0 = auto-detect. Set explicitly if running multiple models concurrently and want to cap CPU usage per model.',
      },
      {
        key: 'autoPullModels',
        label: 'Auto-pull Missing Models',
        type: 'toggle',
        default: false,
        help: 'When chat requests a model not yet in the local Ollama library, automatically `ollama pull` it. Disabled by default to prevent surprise downloads.',
      },
    ],
  },
  anthropic: {
    label: 'Anthropic', icon: <AnthropicIcon size={20} />, color: 'var(--provider-anthropic)',
    bgColor: 'bg-[color-mix(in_srgb,var(--color-warn)_10%,transparent)]', borderColor: 'border-[color-mix(in_srgb,var(--color-warn)_30%,transparent)]',
    description: 'Direct Claude API access',
    authFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
      { key: 'baseUrl', label: 'Base URL', type: 'text', placeholder: 'https://api.anthropic.com' },
    ],
    providerConfigFields: [
      {
        key: 'promptCachingBeta',
        label: 'Enable Prompt Caching (beta)',
        type: 'toggle',
        default: true,
        help: 'Use Anthropic prompt caching to reduce input cost on repeated system prompts and tool definitions. Beta header sent automatically.',
      },
      {
        key: 'extendedThinkingDefault',
        label: 'Default Extended Thinking',
        type: 'select',
        default: 'off',
        options: [
          { value: 'off', label: 'Off' },
          { value: 'low', label: 'Low (≤8K thinking tokens)' },
          { value: 'medium', label: 'Medium (≤32K thinking tokens)' },
          { value: 'high', label: 'High (≤64K thinking tokens)' },
        ],
        help: 'Default thinking budget for Opus/Sonnet 4.x. Per-request override via extended_thinking parameter.',
      },
    ],
  },
  openai: {
    label: 'OpenAI', icon: <OpenAIIcon size={20} />, color: 'var(--provider-openai)',
    bgColor: 'bg-[color-mix(in_srgb,var(--color-ok)_10%,transparent)]', borderColor: 'border-[color-mix(in_srgb,var(--color-ok)_30%,transparent)]',
    description: 'Direct GPT API or compatible endpoints',
    authFields: [
      { key: 'apiKey', label: 'API Key', type: 'password', required: true },
      { key: 'baseUrl', label: 'Base URL', type: 'text', placeholder: 'https://api.openai.com/v1' },
    ],
    providerConfigFields: [
      {
        key: 'organizationId',
        label: 'Organization ID (optional)',
        type: 'text',
        placeholder: 'org-...',
        help: 'OpenAI organization to bill against. Required if your API key is part of multiple orgs.',
      },
      {
        key: 'projectId',
        label: 'Project ID (optional)',
        type: 'text',
        placeholder: 'proj_...',
        help: 'OpenAI project ID. Used for usage tracking and rate limit isolation.',
      },
    ],
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED STYLES
// ═══════════════════════════════════════════════════════════════════════════════

// M3 Expressive (task #160): inputs at rounded-input-sm (16px), no hard
// border at rest. Pill-shaped primary / danger buttons; btn (12px) secondary.
export const inputCls = "w-full px-4 py-2.5 rounded-input-sm border text-sm transition-[border-color,box-shadow] duration-200 ease-emphasized focus:outline-none focus:shadow-focus-ring";
export const inputStyle: React.CSSProperties = { backgroundColor: 'var(--surface-1)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' };
export const btnPrimary = "px-6 py-2 rounded-pill text-sm font-medium bg-primary-500 text-on-accent hover:bg-primary-600 transition-[background,transform] duration-200 ease-emphasized active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:shadow-focus-ring";
export const btnSecondary = "px-4 py-2 rounded-btn text-sm font-medium border transition-[background,transform] duration-200 ease-emphasized active:scale-[0.98] hover:brightness-110 focus-visible:outline-none focus-visible:shadow-focus-ring";
export const btnDanger = "px-6 py-2 rounded-pill text-sm font-medium bg-[color-mix(in_srgb,var(--color-err)_15%,transparent)] text-err border border-[color-mix(in_srgb,var(--color-err)_30%,transparent)] transition-[background,transform] duration-200 ease-emphasized active:scale-[0.98] hover:bg-[color-mix(in_srgb,var(--color-err)_25%,transparent)] focus-visible:outline-none focus-visible:shadow-focus-ring";

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/** Resolve health status considering enabled, paused, DB status, and health check data */
export function resolveHealthStatus(provider: DbProvider, health?: HealthInfo): HealthStatus {
  if (!provider.enabled) return 'disabled';
  if (provider.provider_config?.paused) return 'paused';
  if (health?.status) return health.status;
  const dbStatus = (provider as any).status;
  if (dbStatus === 'active') return 'healthy';
  if (dbStatus === 'error') return 'unhealthy';
  return 'not_initialized';
}

/** Map health status to AdminStatusBadge-compatible string */
export function healthToBadgeStatus(s: HealthStatus): string {
  const map: Record<HealthStatus, string> = {
    healthy: 'healthy', unhealthy: 'unhealthy', not_initialized: 'pending',
    unknown: 'unknown', paused: 'suspended', disabled: 'disabled',
  };
  return map[s] || 'unknown';
}

/** Count configured models on a provider.
 *  Prefers the top-level `models` array (server-built from the Registry
 *  SoT — admin.model_role_assignments — by GET /admin/llm-providers),
 *  then the legacy provider_config.models[] for back-compat with any
 *  older response shape, and finally role-key counting on model_config.
 *  Accepts either a full provider or a bare model_config map. */
export function countModels(input: Record<string, any>): number {
  const topLevelModels = input?.models;
  if (Array.isArray(topLevelModels) && topLevelModels.length > 0) {
    return topLevelModels.length;
  }
  const pcModels = input?.provider_config?.models;
  if (Array.isArray(pcModels) && pcModels.length > 0) {
    return pcModels.length;
  }
  const mc = input?.model_config ?? input ?? {};
  let n = 0;
  if (mc.chatModel) n++;
  if (mc.embeddingModel) n++;
  if (mc.visionModel) n++;
  if (mc.imageModel) n++;
  if (mc.compactionModel) n++;
  return n;
}
