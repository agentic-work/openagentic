/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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
  type NormalizerState,
} from './ILLMProvider.js';
import { NormalizedStreamEvent } from '../NormalizedStreamTypes.js';
import AnthropicFoundry from '@anthropic-ai/foundry-sdk';
import { getBearerTokenProvider, DefaultAzureCredential, ClientSecretCredential } from '@azure/identity';

export class AzureAIFoundryProvider extends BaseLLMProvider {
  readonly name = 'azure-ai-foundry';
  readonly type = 'azure-openai' as const; // Type constraint workaround
  readonly streamFormat = 'openai' as const; // Uses OpenAI-compatible format
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
    this.apiVersion = config?.apiVersion || process.env.AIF_API_VERSION || '2024-08-01-preview';
    this.useUnifiedEndpoint = config?.useUnifiedEndpoint ?? (process.env.AIF_USE_UNIFIED_ENDPOINT === 'true');

    // Timeout configuration - default 120 seconds (Anthropic Claude with many tools can be slow)
    // Can be overridden via config or environment variable
    this.requestTimeout = config?.requestTimeout ||
                          parseInt(process.env.AIF_REQUEST_TIMEOUT || '120000', 10);

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
    } else if (!this.useEntraAuth && !this.apiKey) {
      this.logger.warn('[AzureAIFoundryProvider] Missing both API key and Entra ID credentials - provider will not be functional');
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
    if (this.endpointUrl && (this.apiKey || this.useEntraAuth)) {
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
    if (!this.endpointUrl || (!this.apiKey && !this.useEntraAuth)) return;
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
   * Persist ARM-discovered models to DB so the chat selector has fresh data.
   * The chat selector reads from provider_config.models[], not in-memory.
   */
  private async persistDiscoveredModelsToDb(deployments: Array<{ name: string; modelName: string; modelVersion: string; sku: string; capacity: number }>): Promise<void> {
    const { prisma } = await import('../../utils/prisma.js');
    // Find our provider record by endpoint URL hostname.
    // LLMProviderSeeder writes the field as `provider_config.endpoint`
    // (NOT `endpointUrl`). The previous query used `endpointUrl` which
    // never matched → findFirst returned null → persist exited silently
    // → provider_config.models[] stayed empty forever, which meant
    // auto-discovered AIF deployments never showed up in the chat model
    // selector. Query both names for safety across legacy + current seeds.
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
      this.logger.warn({ accountName }, '[AIF] persistDiscoveredModelsToDb: provider row not found — models will not appear in selector until next restart');
      return;
    }

    const existingConfig = (provider.provider_config as any) || {};
    const modelsForDb = deployments.map(d => ({
      id: d.name,
      name: d.modelName || d.name,
      capabilities: { chat: true, tools: true, streaming: true },
      config: {},
    }));

    await prisma.lLMProvider.update({
      where: { id: provider.id },
      data: {
        provider_config: {
          ...existingConfig,
          models: modelsForDb,
          lastDiscoveryAt: new Date().toISOString(),
        },
      },
    });
    this.logger.info({ provider: provider.name, models: modelsForDb.map(m => m.id) }, '[AIF] Persisted ARM-discovered models to DB');
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
   * Get authentication headers (API key or Entra ID bearer token)
   */
  private async getAuthHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (this.useEntraAuth) {
      // Use Entra ID (Azure AD) authentication
      const token = await this.getEntraToken();
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

    return tools
      .filter(tool => tool.function?.name) // Skip tools without function.name
      .map(tool => ({
        name: tool.function.name,
        description: tool.function?.description || '',
        input_schema: tool.function?.parameters || { type: 'object', properties: {} }
      }));
  }

  /**
   * Convert Anthropic response to OpenAI format
   */
  private convertAnthropicResponseToOpenAI(anthropicResponse: any, modelName: string): CompletionResponse {
    const toolCalls: any[] = [];
    let textContent = '';

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
      }
    }

    const message: any = {
      role: 'assistant',
      content: textContent
    };

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

  /**
   * Detect and parse DeepSeek's proprietary tool call format
   * DeepSeek uses Unicode markers like: <｜tool▁calls▁begin｜>...<｜tool▁calls▁end｜>
   */
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
      const major = parseInt(gptMatch[1]);
      const minor = parseInt(gptMatch[2] || '0');
      if (major >= 5 || (major === 4 && minor >= 1)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Intelligent model selection based on request characteristics
   * Azure model-router cannot be controlled via API parameters, so we implement
   * application-level routing to ensure optimal model selection
   *
   * NOTE: DeepSeek models use proprietary tool call format with Unicode markers.
   * If model-router selects DeepSeek, the parseDeepSeekToolCalls() method will
   * automatically detect and convert the markers to standard OpenAI format.
   * Alternatively, you can exclude DeepSeek via AIF_EXCLUDED_MODELS env var.
   */
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

    const { system, messages } = this.convertToAnthropicMessages(request.messages);
    const tools = this.convertToAnthropicTools(request.tools);

    // Anthropic doesn't support "model-router" - use configured Claude model instead
    let modelToUse = request.model || this.model;
    if (modelToUse === 'model-router' || modelToUse.includes('router')) {
      modelToUse = this.model === 'model-router' ? (process.env.AIF_ANTHROPIC_MODEL || process.env.DEFAULT_MODEL) : this.model;
      this.logger.debug({
        requestedModel: request.model,
        actualModel: modelToUse
      }, '[AzureAIFoundryProvider] Overriding model-router for Anthropic API');
    }

    // Anthropic doesn't allow both temperature and top_p
    // Prefer temperature if both are provided
    const anthropicRequest: any = {
      model: modelToUse,
      messages,
      max_tokens: request.max_tokens ?? 8192,
      stream: request.stream ?? true
    };

    // Only set temperature (Anthropic doesn't support both temperature and top_p)
    // Use environment variable for default, no hardcoded fallback
    const anthropicDefaultTemp = parseFloat(process.env.AIF_TEMPERATURE || '1.0');
    anthropicRequest.temperature = request.temperature ?? anthropicDefaultTemp;

    if (system) {
      anthropicRequest.system = system;
    }

    if (tools && tools.length > 0) {
      anthropicRequest.tools = tools;

      // Convert tool_choice
      if (request.tool_choice) {
        if (request.tool_choice === 'auto') {
          anthropicRequest.tool_choice = { type: 'auto' };
        } else if (request.tool_choice === 'required') {
          anthropicRequest.tool_choice = { type: 'any' };
        } else if (typeof request.tool_choice === 'object' && request.tool_choice.function) {
          anthropicRequest.tool_choice = {
            type: 'tool',
            name: request.tool_choice.function.name
          };
        }
      }
    }

    // Calculate payload size for diagnostics
    const payloadSize = JSON.stringify(anthropicRequest).length;
    const totalMessageChars = messages.reduce((sum: number, msg: any) =>
      sum + (typeof msg.content === 'string' ? msg.content.length : JSON.stringify(msg.content).length), 0);

    this.logger.info({
      model: anthropicRequest.model,
      messageCount: messages.length,
      toolCount: tools?.length || 0,
      hasSystem: !!system,
      systemLength: system?.length || 0,
      stream: request.stream,
      payloadSizeKB: Math.round(payloadSize / 1024),
      totalMessageChars,
      maxTokens: anthropicRequest.max_tokens
    }, '[AzureAIFoundryProvider] Creating Anthropic completion');

    // TODO: AIF Anthropic streaming has event format issues with the completion stage.
    // Force non-streaming for now to unblock UC testing. Fix streaming in next iteration.
    if (false && request.stream) {
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

    // Get Entra token
    const token = this.useEntraAuth ? await this.getEntraToken() : null;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    } else if (this.apiKey) {
      headers['api-key'] = this.apiKey;
    }

    // Convert messages to Anthropic format
    const { system, messages } = this.convertToAnthropicMessages(request.messages);
    const tools = this.convertToAnthropicTools(request.tools);

    const modelToUse = request.model || this.model;
    const body: any = {
      model: modelToUse,
      messages,
      max_tokens: request.max_tokens ?? 8192,
      stream: request.stream ?? true,
    };
    if (system) body.system = system;
    if (tools?.length) {
      body.tools = tools;
      if (request.tool_choice === 'auto') body.tool_choice = { type: 'auto' };
    }
    // Anthropic requires temperature=1 for thinking models
    body.temperature = request.temperature ?? 1;

    this.logger.info({ url, model: modelToUse, stream: body.stream, messageCount: messages.length, toolCount: tools?.length || 0 },
      '[AIF-Anthropic] Raw fetch to services.ai.azure.com');

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

    // Build OpenAI-compatible request - adapt parameters based on model
    const maxTokens = request.max_tokens ?? 8192;

    // GPT-5.x models only support temperature=1, so don't include temperature for those
    const isGPT5 = selectedModel.toLowerCase().includes('gpt-5');
    const defaultTemperature = parseFloat(process.env.AIF_TEMPERATURE || '1.0');

    const aifRequest: any = {
      model: selectedModel,
      messages: request.messages,
      top_p: request.top_p ?? 1,
      stream: request.stream ?? true,
      stream_options: request.stream ? { include_usage: true } : undefined
    };

    // o-series reasoning models and GPT-5 don't support temperature parameter
    const isReasoningModel = selectedModel.toLowerCase().includes('o1') || selectedModel.toLowerCase().includes('o3') || selectedModel.toLowerCase().includes('o4');
    if (!isGPT5 && !isReasoningModel) {
      aifRequest.temperature = request.temperature ?? defaultTemperature;
    }
    // o-series also don't support top_p
    if (isReasoningModel) {
      delete aifRequest.top_p;
    }

    // GPT-5.1+ and o1/o3 models use max_completion_tokens instead of max_tokens
    // Detect based on model name pattern
    const usesMaxCompletionTokens = this.modelUsesMaxCompletionTokens(selectedModel);
    if (usesMaxCompletionTokens) {
      aifRequest.max_completion_tokens = maxTokens;
    } else {
      aifRequest.max_tokens = maxTokens;
    }

    // Add tools if present (OpenAI tool format)
    // Ensure all tools have required 'type: "function"' field for Azure OpenAI API
    if (request.tools && request.tools.length > 0) {
      aifRequest.tools = request.tools.map((tool: any) => ({
        type: 'function',
        ...tool,
        // If tool has nested 'function' property, keep it; otherwise wrap name/description/parameters
        function: tool.function || {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters || tool.input_schema || { type: 'object', properties: {} }
        }
      }));

      // Optimize tool_choice for better function calling
      // "auto" = model decides (best for GPT-5)
      // "required" = force function call (not supported by all models)
      aifRequest.tool_choice = request.tool_choice || 'auto';
    }

    // Pass through reasoning_effort if provided (let the API handle unsupported params)
    if ((request as any).reasoning_effort) {
      aifRequest.reasoning_effort = (request as any).reasoning_effort;
      this.logger.info({
        model: selectedModel,
        reasoning_effort: aifRequest.reasoning_effort
      }, '[AzureAIFoundryProvider] 🧠 Reasoning effort parameter included');
    }

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
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(aifRequest)
      });

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

              // Track tokens
              if (chunk.usage) {
                totalTokens = chunk.usage.total_tokens || 0;
              }

              // Track success
              const latency = Date.now() - startTime;
              this.trackSuccess(latency, totalTokens, 0);

              this.logger.info({
                model: modelName,
                duration: latency,
                totalTokens,
                hadDeepSeekMarkers: hasDeepSeekMarkers
              }, '[AzureAIFoundryProvider] Stream completed');
            } else {
              // Not done yet, yield the chunk as-is
              yield chunk;

              // Track tokens
              if (chunk.usage) {
                totalTokens = chunk.usage.total_tokens || 0;
              }
            }
          } catch (parseError) {
            this.logger.warn({ line, error: parseError }, '[AzureAIFoundryProvider] Failed to parse chunk');
          }
        }
      }

    } catch (error) {
      this.trackFailure();
      this.logger.error({ error }, '[AzureAIFoundryProvider] Stream failed');
      throw error;
    }
  }

  /**
   * Non-streaming completion
   */
  private async nonStreamCompletion(
    aifRequest: any,
    modelName: string,
    startTime: number
  ): Promise<CompletionResponse> {
    try {
      const headers = await this.getAuthHeaders();
      const endpointUrl = this.getEndpointUrl(modelName);
      const response = await fetch(endpointUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...aifRequest, stream: false })
      });

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

      // Simple health check with minimal request
      // Use the appropriate API format
      if (this.isAnthropicFormat && this.anthropicClient) {
        // Anthropic Messages API health check
        try {
          await this.anthropicClient.messages.create({
            model: this.model,
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
        const isReasoningModel = this.model.includes('o3') || this.model.includes('o1');
        const tokenParam = isReasoningModel
          ? { max_completion_tokens: 5 }
          : { max_tokens: 1 };
        const response = await fetch(healthUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: this.model,
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

    // ─── PHASE 2: Full Azure AI model catalog (all deployable models) ───
    try {
      const catalogModels = await this.listCatalogModels();
      for (const cm of catalogModels) {
        // Skip if already deployed (shown above)
        if (deployedIds.has(cm.name)) continue;
        const ml = cm.name.toLowerCase();
        models.push({
          id: cm.name,
          name: `${cm.name}${cm.version ? ` (${cm.version})` : ''}`,
          provider: 'azure-ai-foundry',
          description: `Available — ${cm.format}. SKUs: ${cm.skus.join(', ')}`,
          modelFormat: cm.format,
          modelVersion: cm.version,
          family: this.inferFamily(ml),
          costTier: this.inferCostTier(ml),
          capabilities: this.inferCapabilities(ml),
          contextWindow: this.inferContextWindow(ml),
          maxOutputTokens: this.inferMaxOutput(ml),
          configured: false,
          deployed: false,
        } as any);
      }
      this.logger.info({ deployed: deployedIds.size, catalog: catalogModels.length, total: models.length }, '[AIF] Discovery complete (deployed + catalog)');
    } catch (err: any) {
      this.logger.warn({ error: err.message }, '[AIF] Catalog discovery failed — showing deployed only');
    }

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

  // ─── Capability inference helpers (no hardcoded model lists) ───

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

  /**
   * Normalize a raw Azure AI Foundry stream chunk into NormalizedStreamEvents.
   * Delegates to the exported pure function for testability.
   */
  normalizeChunk(rawChunk: any, state: NormalizerState): NormalizedStreamEvent[] {
    return normalizeAzureAIFoundryChunk(rawChunk, state);
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

    // Use Entra ID token if configured, otherwise API key
    if (this.useEntraAuth) {
      const token = await this.getEntraToken();
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

// ---------------------------------------------------------------------------
// Exported normalizer function — pure, per-chunk, state-mutating
// ---------------------------------------------------------------------------

/**
 * Normalizes a single raw Azure AI Foundry streaming chunk into zero or more
 * NormalizedStreamEvents. Handles two formats:
 *
 * Format A: Anthropic-style content_block_* events (from reasoning models like o3-mini
 *           that go through the streamCompletion thinking transform)
 * Format B: OpenAI-style choices[0].delta chunks (standard model streaming)
 *
 * State is mutated in place to track block types, thinking accumulation,
 * synthetic thinking, and pending tools across chunk boundaries.
 */
export function normalizeAzureAIFoundryChunk(rawChunk: any, state: NormalizerState): NormalizedStreamEvent[] {
  const events: NormalizedStreamEvent[] = [];

  // Format A: Anthropic-style content_block events (from reasoning models)
  if (typeof rawChunk.type === 'string' && rawChunk.type.startsWith('content_block')) {
    return normalizeContentBlockChunk(rawChunk, state, events);
  }

  // Format B: OpenAI-style chunks
  return normalizeOpenAIStyleChunk(rawChunk, state, events);
}

/**
 * Handles Anthropic-style content_block_start/delta/stop events that come
 * from the reasoning model path in streamCompletion().
 * Uses the same logic as the Anthropic normalizer.
 */
function normalizeContentBlockChunk(
  rawChunk: any,
  state: NormalizerState,
  events: NormalizedStreamEvent[]
): NormalizedStreamEvent[] {
  // Emit stream_start on the first Format A event (reasoning model path never sees an
  // OpenAI-style first chunk, so we must emit it here instead).
  if (!state.streamStartEmitted) {
    state.streamStartEmitted = true;
    events.push({
      type: 'stream_start',
      messageId: '',
      model: state.model || '',
      provider: 'azure-ai-foundry',
    });
  }

  const blockTypes = state.blockTypes;

  switch (rawChunk.type) {
    case 'content_block_start': {
      const block = rawChunk.content_block;
      const index: number = rawChunk.index;
      if (block?.type === 'thinking') {
        const id = `tk-${index}`;
        state.thinkingId = id;
        state.thinkingStartTime = Date.now();
        state.thinkingAccumulated = '';
        blockTypes.set(index, { type: 'thinking', id });
        events.push({ type: 'thinking_start', id });
      } else if (block?.type === 'text') {
        const id = `txt-${index}`;
        state.textBlockId = id;
        blockTypes.set(index, { type: 'text', id });
        events.push({ type: 'text_start', id });
      } else if (block?.type === 'tool_use') {
        const id = block.id || `tool-${index}`;
        blockTypes.set(index, { type: 'tool_use', id });
        events.push({ type: 'tool_start', id, toolName: block.name || '', serverName: '' });
      }
      break;
    }

    case 'content_block_delta': {
      const delta = rawChunk.delta;
      const index: number = rawChunk.index;
      const blockInfo = blockTypes.get(index);

      if (delta?.type === 'thinking_delta') {
        state.thinkingAccumulated += delta.thinking || '';
        events.push({
          type: 'thinking_delta',
          id: blockInfo?.id || state.thinkingId || `tk-${index}`,
          content: delta.thinking || '',
          accumulated: state.thinkingAccumulated,
        });
      } else if (delta?.type === 'text_delta') {
        events.push({
          type: 'text_delta',
          id: blockInfo?.id || state.textBlockId || `txt-${index}`,
          content: delta.text || '',
        });
      } else if (delta?.type === 'input_json_delta') {
        const toolId = blockInfo?.id || `tool-${index}`;
        events.push({ type: 'tool_delta', id: toolId, argsFragment: delta.partial_json || '' });
      }
      break;
    }

    case 'content_block_stop': {
      const index: number = rawChunk.index;
      const blockInfo = blockTypes.get(index);
      if (blockInfo?.type === 'thinking') {
        const elapsed = state.thinkingStartTime ? Date.now() - state.thinkingStartTime : 0;
        events.push({ type: 'thinking_stop', id: blockInfo.id, elapsedMs: elapsed });
        state.thinkingId = null;
        state.thinkingStartTime = null;
        state.thinkingAccumulated = '';
      } else if (blockInfo?.type === 'text') {
        events.push({ type: 'text_stop', id: blockInfo.id });
        state.textBlockId = null;
      } else if (blockInfo?.type === 'tool_use') {
        events.push({ type: 'tool_stop', id: blockInfo.id, result: null, durationMs: 0 });
      }
      blockTypes.delete(index);
      break;
    }
  }

  return events;
}

/**
 * Handles OpenAI-style streaming chunks (choices[0].delta).
 * Emits a synthetic thinking block on the first chunk so every response
 * has a thinking node in the activity tree.
 */
function normalizeOpenAIStyleChunk(
  rawChunk: any,
  state: NormalizerState,
  events: NormalizedStreamEvent[]
): NormalizedStreamEvent[] {
  const pendingTools = state.pendingTools;

  const choice = rawChunk.choices?.[0];

  // Usage-only chunk (no choices)
  if (!choice && rawChunk.usage) {
    events.push({
      type: 'usage',
      tokensIn: rawChunk.usage.prompt_tokens || 0,
      tokensOut: rawChunk.usage.completion_tokens || 0,
      cost: 0,
      contextUsed: 0,
      contextMax: 0,
    });
    return events;
  }

  if (!choice) return events;

  const delta = choice.delta;
  if (!delta && !choice.finish_reason) return events;

  // -----------------------------------------------------------------------
  // First chunk — role === 'assistant': emit stream_start + synthetic thinking
  // -----------------------------------------------------------------------
  if (delta?.role === 'assistant' && !state.streamStartEmitted) {
    state.streamStartEmitted = true;
    state.model = rawChunk.model || '';
    events.push({
      type: 'stream_start',
      messageId: rawChunk.id || '',
      model: rawChunk.model || '',
      provider: 'azure-ai-foundry',
    });

    // Emit synthetic thinking block (closed when real content arrives)
    const thinkId = 'tk-synth-0';
    state.thinkingId = thinkId;
    state.thinkingStartTime = Date.now();
    events.push({ type: 'thinking_start', id: thinkId });
    events.push({ type: 'thinking_delta', id: thinkId, content: 'Processing', accumulated: 'Processing' });
    return events;
  }

  // -----------------------------------------------------------------------
  // Helper: close synthetic thinking if still active
  // -----------------------------------------------------------------------
  const closeSyntheticThinking = () => {
    if (state.thinkingId) {
      const elapsed = state.thinkingStartTime ? Date.now() - state.thinkingStartTime : 0;
      events.push({ type: 'thinking_stop', id: state.thinkingId, elapsedMs: elapsed });
      state.thinkingId = null;
      state.thinkingStartTime = null;
    }
  };

  // -----------------------------------------------------------------------
  // Text content delta
  // -----------------------------------------------------------------------
  if (delta?.content) {
    closeSyntheticThinking();
    if (!state.textBlockId) {
      state.textBlockId = 'txt-0';
      events.push({ type: 'text_start', id: state.textBlockId });
    }
    events.push({ type: 'text_delta', id: state.textBlockId, content: delta.content });
  }

  // -----------------------------------------------------------------------
  // Tool call deltas
  // -----------------------------------------------------------------------
  if (delta?.tool_calls) {
    closeSyntheticThinking();
    for (const tc of delta.tool_calls) {
      if (tc.function?.name) {
        const toolId = tc.id || `tool-${tc.index}`;
        pendingTools.set(toolId, tc.function.name);
        state.toolIndexToId.set(tc.index, toolId);
        events.push({ type: 'tool_start', id: toolId, toolName: tc.function.name, serverName: '' });
      }
      if (tc.function?.arguments) {
        // Resolve tool ID: prefer explicit id, then toolIndexToId map, then fallback
        const toolId = tc.id || state.toolIndexToId.get(tc.index) || `tool-${tc.index}`;
        events.push({ type: 'tool_delta', id: toolId, argsFragment: tc.function.arguments });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Finish reason
  // -----------------------------------------------------------------------
  if (choice.finish_reason) {
    if (choice.finish_reason === 'tool_calls') {
      for (const [id] of pendingTools) {
        events.push({ type: 'tool_stop', id, result: null, durationMs: 0 });
      }
      pendingTools.clear();
    }

    if (state.textBlockId) {
      events.push({ type: 'text_stop', id: state.textBlockId });
      state.textBlockId = null;
    }

    // Close any still-open synthetic thinking (e.g. response with no content)
    closeSyntheticThinking();

    events.push({
      type: 'stream_end',
      finishReason: choice.finish_reason === 'stop' ? 'stop' : choice.finish_reason,
      totalDurationMs: 0,
    });
  }

  // -----------------------------------------------------------------------
  // Usage embedded in the same chunk
  // -----------------------------------------------------------------------
  if (rawChunk.usage) {
    events.push({
      type: 'usage',
      tokensIn: rawChunk.usage.prompt_tokens || 0,
      tokensOut: rawChunk.usage.completion_tokens || 0,
      cost: 0,
      contextUsed: 0,
      contextMax: 0,
    });
  }

  return events;
}
