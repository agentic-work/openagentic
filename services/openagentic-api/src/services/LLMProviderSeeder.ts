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
 * LLM Provider Seeder
 *
 * Seeds LLM providers from environment variables into the database at startup.
 * This ensures the database is the single source of truth while allowing
 * initial configuration via environment variables.
 *
 * Flow:
 * 1. Read provider configs from env vars
 * 2. Check if provider already exists in DB
 * 3. If not, create it with env var config
 * 4. If yes, skip (don't overwrite manual changes)
 */

import { prisma } from '../utils/prisma.js';
import { logger } from '../utils/logger.js';
import { encryptAuthConfig } from './llm-providers/CredentialEncryptionService.js';

/**
 * Seeder version — bumped when the seed schema itself changes (new fields,
 * new providers). In v4+ the version is mostly a tracking field; the
 * env-driven fields (deployment, models[], modelId, etc.) are re-synced
 * UNCONDITIONALLY on every pod start (unless the admin has taken ownership
 * of the provider — see seeder_managed flag below). Previous versions
 * gated env sync on `dbSeederVersion >= SEEDER_VERSION` which caused
 * stale data to stick when env values changed between restarts at the
 * same seeder_version.
 *
 * v3 (2026-04-11 early): forced re-sync after model-router/aif-gpt-54
 * legacy placeholders were removed from values files.
 * v4 (2026-04-11 later): gpt-5.4 deleted from foundries, default AIF
 * deployment flipped to claude-opus-4-6. Stuck at v3 re-sync refused
 * to fire, hence this bump — and the env sync logic is now
 * version-independent anyway so future env-only changes don't need
 * a bump.
 */
const SEEDER_VERSION = 4;

interface ProviderSeedConfig {
  name: string;
  displayName: string;
  providerType: string;
  enabled: boolean;
  priority: number;
  authConfig: Record<string, any>;
  providerConfig: Record<string, any>;
  modelConfig: Record<string, any>;
  capabilities: Record<string, boolean>;
  description: string;
}

/**
 * Seed LLM providers from environment variables
 * Called once at API startup
 */
export async function seedLLMProviders(): Promise<void> {
  const log = logger.child({ service: 'LLMProviderSeeder' });
  log.info('Starting LLM provider seeding from environment variables');

  const providers: ProviderSeedConfig[] = [];

  try {
    // =========================================================================
    // OLLAMA
    // =========================================================================
    if (process.env.OLLAMA_ENABLED === 'true') {
      const baseUrl = process.env.OLLAMA_BASE_URL || process.env.OLLAMA_HOST || 'http://localhost:11434';
      const model = process.env.OLLAMA_MODEL || process.env.DEFAULT_MODEL!;

      providers.push({
        name: 'ollama',
        displayName: `Ollama - ${model}`,
        providerType: 'ollama',
        enabled: true,
        priority: parseInt(process.env.OLLAMA_PRIORITY || '1'),
        authConfig: {}, // Ollama doesn't need auth
        providerConfig: {
          baseUrl,
          modelId: model,
          keepAlive: process.env.OLLAMA_KEEP_ALIVE || '30m',
        },
        modelConfig: {
          defaultModel: model,
          chatModel: model,
          toolModel: process.env.OLLAMA_TOOL_MODEL || model,
          visionModel: process.env.OLLAMA_VISION_MODEL || '',
          embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
          maxTokens: parseInt(process.env.OLLAMA_MAX_TOKENS || '8192'),
          temperature: parseFloat(process.env.OLLAMA_TEMPERATURE || '0.7'),
          contextWindow: 128000,
        },
        capabilities: {
          chat: true,
          tools: true,
          vision: !!process.env.OLLAMA_VISION_MODEL,
          streaming: true,
          embeddings: true,
        },
        description: 'Local Ollama instance',
      });

      // Add tool model as separate entry if different
      const toolModel = process.env.OLLAMA_TOOL_MODEL;
      if (toolModel && toolModel !== model) {
        providers.push({
          name: `ollama-${toolModel.replace(/[^a-z0-9]/gi, '-')}`,
          displayName: `Ollama - ${toolModel}`,
          providerType: 'ollama',
          enabled: true,
          priority: 2,
          authConfig: {},
          providerConfig: {
            baseUrl,
            modelId: toolModel,
          },
          modelConfig: {
            defaultModel: toolModel,
            chatModel: toolModel,
          },
          capabilities: { chat: true, tools: true, streaming: true },
          description: `Ollama ${toolModel} model`,
        });
      }
    }

    // =========================================================================
    // AWS BEDROCK
    // =========================================================================
    if (process.env.AWS_BEDROCK_ENABLED === 'true') {
      const region = process.env.AWS_REGION || process.env.AWS_BEDROCK_REGION || 'us-east-1';
      // Bedrock-specific model env vars only — never fall back to DEFAULT_MODEL (that's for Ollama)
      const model = process.env.AWS_BEDROCK_CHAT_MODEL || process.env.AWS_BEDROCK_MODEL_ID || '';

      providers.push({
        name: 'aws-bedrock',
        displayName: `AWS Bedrock (${region})`,
        providerType: 'aws-bedrock',
        enabled: true,
        priority: parseInt(process.env.AWS_BEDROCK_PRIORITY || '2'),
        authConfig: {
          type: process.env.AWS_ACCESS_KEY_ID ? 'iam-keys' : 'iam-role',
          accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
          roleArn: process.env.AWS_ROLE_ARN || '',
          region,
        },
        providerConfig: {
          region,
          ...(model ? { modelId: model } : {}),
        },
        modelConfig: {
          ...(model ? { defaultModel: model, chatModel: model } : {}),
          maxTokens: parseInt(process.env.AWS_BEDROCK_MAX_TOKENS || '16000'),
          temperature: parseFloat(process.env.AWS_BEDROCK_TEMPERATURE || '1.0'),
          contextWindow: 200000,
        },
        capabilities: {
          chat: true,
          tools: true,
          vision: true,
          streaming: true,
          thinking: model.includes('claude'),
        },
        description: 'AWS Bedrock with Claude models',
      });
    }

    // =========================================================================
    // GOOGLE VERTEX AI
    // =========================================================================
    if (process.env.VERTEX_AI_ENABLED === 'true') {
      const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID || '';
      const location = process.env.GCP_REGION || process.env.VERTEX_AI_LOCATION || 'us-central1';
      const model = process.env.VERTEX_AI_MODEL || process.env.VERTEX_AI_CHAT_MODEL || process.env.DEFAULT_MODEL!;

      providers.push({
        name: 'vertex-ai',
        displayName: 'Google Vertex AI',
        providerType: 'vertex-ai',
        enabled: true,
        priority: parseInt(process.env.VERTEX_AI_PRIORITY || '2'),
        authConfig: {
          type: process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'service-account' : 'adc',
          serviceAccountPath: process.env.GOOGLE_APPLICATION_CREDENTIALS || '',
          projectId,
        },
        providerConfig: {
          projectId,
          location,
          modelId: model,
        },
        modelConfig: {
          defaultModel: model,
          chatModel: model,
          thinkingModel: process.env.VERTEX_THINKING_MODEL || model,
          embeddingModel: process.env.VERTEX_EMBEDDING_MODEL || 'text-embedding-004',
          maxTokens: 65536,
          temperature: 1.0,
          contextWindow: 1000000,
        },
        capabilities: {
          chat: true,
          tools: true,
          vision: true,
          streaming: true,
          thinking: true,
          embeddings: true,
          grounding: true,
        },
        description: 'Google Vertex AI with Gemini models',
      });
    }

    // =========================================================================
    // AZURE OPENAI
    // =========================================================================
    if (process.env.AZURE_OPENAI_ENABLED === 'true') {
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT || '';
      const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || '';
      const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview';

      // Multi-deployment support (v3). When Azure AI Foundry deployments have
      // per-model deployments (gpt-5.4-dev, claude-opus-4-6-dev,
      // o3-tier2-dev), the chart sets AZURE_OPENAI_DEPLOYMENTS as a
      // comma-separated list. Each entry becomes a model in the
      // provider_config.models[] array so the chat model selector
      // shows all of them. The primary `deployment` (AZURE_OPENAI_DEPLOYMENT)
      // is still used as the default for simple chat completions.
      const deploymentsRaw = process.env.AZURE_OPENAI_DEPLOYMENTS || '';
      const deploymentList = deploymentsRaw
        .split(',')
        .map(d => d.trim())
        .filter(Boolean);
      const allDeployments = deploymentList.length > 0
        ? deploymentList
        : (deployment ? [deployment] : []);

      const inferCapabilities = (d: string) => {
        const l = d.toLowerCase();
        return {
          chat: true,
          tools: true,
          streaming: true,
          vision: l.includes('vision') || l.includes('gpt-4o') || l.includes('gpt-5') || l.includes('claude'),
          thinking: l.includes('o1') || l.includes('o3') || l.includes('claude') || l.includes('opus') || l.includes('sonnet'),
          embeddings: l.includes('embed'),
          imageGeneration: l.includes('dall-e') || l.includes('gpt-image'),
        };
      };

      const modelsArray = allDeployments.map(d => ({
        id: d,
        name: d,
        capabilities: inferCapabilities(d),
        config: {},
      }));

      // AZURE_OPENAI_EMBEDDING_DEPLOYMENT names the Azure deployment used
      // for text embeddings (e.g. `text-embedding-3-large-dev`). When set,
      // this provider is embedding-capable and UniversalEmbeddingService /
      // server.ts's setDbEmbeddingConfig pick it up as the active
      // embedding provider. Without this, the seeder used to write
      // azure-openai with no `capabilities.embeddings` and no
      // `modelConfig.embeddingModel` — forcing the embedding picker to
      // fall through to ollama and breaking every RAG / tool-search /
      // semantic-learning call with a 404 on the missing nomic model.
      const azureEmbeddingDeployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT || '';

      providers.push({
        name: 'azure-openai',
        displayName: 'Azure OpenAI',
        providerType: 'azure-openai',
        enabled: true,
        priority: parseInt(process.env.AZURE_OPENAI_PRIORITY || '2'),
        authConfig: {
          type: process.env.AZURE_OPENAI_API_KEY ? 'api-key' : 'entra-id',
          apiKey: process.env.AZURE_OPENAI_API_KEY || '',
          tenantId: process.env.AZURE_TENANT_ID || '',
          clientId: process.env.AZURE_CLIENT_ID || '',
          clientSecret: process.env.AZURE_CLIENT_SECRET || '',
        },
        providerConfig: {
          endpoint,
          deployment,
          apiVersion,
          modelId: deployment,
          // Multi-deployment models list — overwrites any stale entries
          // from a previous seeder run (e.g. leftover model-router from
          // before the the env vars were corrected).
          models: modelsArray,
        },
        modelConfig: {
          defaultModel: deployment,
          chatModel: deployment,
          // When AZURE_OPENAI_EMBEDDING_DEPLOYMENT is set, expose this
          // provider as the embedding source. server.ts:setDbEmbeddingConfig
          // will then prefer it over ollama.
          ...(azureEmbeddingDeployment ? { embeddingModel: azureEmbeddingDeployment } : {}),
          maxTokens: 16000,
          temperature: 1.0,
        },
        capabilities: {
          chat: true,
          tools: true,
          vision: deployment.includes('vision') || deployment.includes('gpt-4o') || deployment.includes('gpt-5') || deployment.includes('claude'),
          streaming: true,
          ...(azureEmbeddingDeployment ? { embeddings: true } : {}),
        },
        description: 'Azure OpenAI Service',
      });
    }

    // =========================================================================
    // ANTHROPIC (Direct API)
    // =========================================================================
    if (process.env.ANTHROPIC_API_KEY) {
      const model = process.env.ANTHROPIC_MODEL || process.env.DEFAULT_MODEL!;

      providers.push({
        name: 'anthropic',
        displayName: 'Anthropic Claude',
        providerType: 'anthropic',
        enabled: true,
        priority: parseInt(process.env.ANTHROPIC_PRIORITY || '2'),
        authConfig: {
          type: 'api-key',
          apiKey: process.env.ANTHROPIC_API_KEY,
        },
        providerConfig: {
          baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
          modelId: model,
        },
        modelConfig: {
          defaultModel: model,
          chatModel: model,
          maxTokens: 8192,
          temperature: 1.0,
          contextWindow: 200000,
        },
        capabilities: {
          chat: true,
          tools: true,
          vision: true,
          streaming: true,
          thinking: true,
        },
        description: 'Anthropic Claude API',
      });
    }

    // =========================================================================
    // OPENAI (Direct API)
    // =========================================================================
    if (process.env.OPENAI_API_KEY) {
      const model = process.env.OPENAI_MODEL || process.env.DEFAULT_MODEL!;

      providers.push({
        name: 'openai',
        displayName: 'OpenAI',
        providerType: 'openai',
        enabled: true,
        priority: parseInt(process.env.OPENAI_PRIORITY || '2'),
        authConfig: {
          type: 'api-key',
          apiKey: process.env.OPENAI_API_KEY,
        },
        providerConfig: {
          baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
          modelId: model,
          organization: process.env.OPENAI_ORG_ID || '',
        },
        modelConfig: {
          defaultModel: model,
          chatModel: model,
          embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
          maxTokens: 16000,
          temperature: 1.0,
          contextWindow: 128000,
        },
        capabilities: {
          chat: true,
          tools: true,
          vision: true,
          streaming: true,
          embeddings: true,
        },
        description: 'OpenAI API',
      });
    }

    // =========================================================================
    // AZURE AI FOUNDRY (uses platform app registration for auth)
    // =========================================================================
    if (process.env.AIF_ENABLED === 'true' || process.env.AIF_ENDPOINT_URL) {
      const endpoint = process.env.AIF_ENDPOINT_URL || '';
      // AIF_MODEL = Azure deployment name (e.g. "gpt-41" — no dots allowed)
      // AIF_CHAT_MODEL = actual model name (e.g. "gpt-4.1")
      const deploymentName = process.env.AIF_MODEL || '';
      const chatModel = process.env.AIF_CHAT_MODEL || deploymentName;

      // Prefer platform app registration creds (already configured for SSO)
      // Fall back to AIF-specific creds only if platform creds missing
      const tenantId = process.env.AZURE_AD_TENANT_ID || process.env.AIF_TENANT_ID || '';
      const clientId = process.env.AAD_CLIENT_ID || process.env.AIF_CLIENT_ID || '';
      const clientSecret = process.env.AZURE_AD_CLIENT_SECRET || process.env.AIF_CLIENT_SECRET || '';

      providers.push({
        name: 'azure-ai-foundry',
        displayName: 'Azure AI Foundry',
        providerType: 'azure-ai-foundry',
        enabled: true,
        priority: parseInt(process.env.AIF_PRIORITY || '2'),
        authConfig: {
          type: tenantId && clientId && clientSecret ? 'entra-id' : 'api-key',
          tenantId,
          clientId,
          clientSecret,
          apiKey: process.env.AIF_API_KEY || '',
        },
        providerConfig: {
          endpoint,
          modelId: chatModel,
          deploymentName,
          apiVersion: process.env.AIF_API_VERSION || '2024-10-21',
          functionCallingModel: process.env.AIF_FUNCTION_CALLING_MODEL || '',
        },
        modelConfig: {
          defaultModel: chatModel,
          chatModel,
          maxTokens: parseInt(process.env.AIF_MAX_TOKENS || '16384'),
          temperature: parseFloat(process.env.AIF_TEMPERATURE || '1.0'),
          contextWindow: 128000,
        },
        capabilities: {
          chat: true,
          tools: true,
          vision: true,
          streaming: true,
          thinking: true,
        },
        description: 'Azure AI Foundry with model router',
      });

      // Models are auto-discovered from the Azure deployments API during
      // AzureAIFoundryProvider.initialize() — no env vars needed.
      // AIF_DEPLOYMENT_MAP and AIF_ADDITIONAL_MODELS are dead code.
    }

    // =========================================================================
    // SEED TO DATABASE
    // =========================================================================
    let seeded = 0;
    let skipped = 0;

    for (const provider of providers) {
      try {
        // Check if provider already exists
        const existing = await prisma.lLMProvider.findUnique({
          where: { name: provider.name }
        });

        if (existing) {
          const existingModelConfig = existing.model_config as Record<string, any> || {};
          const existingProviderConfig = existing.provider_config as Record<string, any> || {};
          const envModelConfig = provider.modelConfig;
          const envProviderConfig = provider.providerConfig;
          let updated = false;

          // Check if admin has taken ownership of this provider. Admin-owned
          // rows are NEVER re-synced from env (the admin's UI edits are
          // authoritative). Non-admin-owned rows are re-synced from env on
          // EVERY pod start — unconditional, not gated on SEEDER_VERSION.
          // The old version-gated path had a sev-0 where env values changed
          // but the DB row stayed at the previous seeder version and the
          // sync was skipped, stranding stale data in the provider config.
          const seederManaged = existingProviderConfig.seeder_managed;
          const isAdminOwned = seederManaged === false;

          if (isAdminOwned) {
            log.debug({ provider: provider.name }, 'Provider is admin-owned (seeder_managed=false) — skipping model/infra sync');
          }

          if (!isAdminOwned) {
            // Only update fields that are explicitly set in env vars (non-empty)
            for (const field of ['chatModel', 'defaultModel', 'economicalModel', 'premiumModel', 'ultraPremiumModel', 'embeddingModel', 'toolModel', 'visionModel', 'thinkingModel'] as const) {
              const envValue = envModelConfig[field];
              if (envValue && envValue !== existingModelConfig[field]) {
                existingModelConfig[field] = envValue;
                updated = true;
              }
            }

            // Also sync provider_config.modelId to prevent stale model IDs
            if (envProviderConfig.modelId && envProviderConfig.modelId !== existingProviderConfig.modelId) {
              existingProviderConfig.modelId = envProviderConfig.modelId;
              updated = true;
            }

            // Sync infrastructure fields from env vars (env is authoritative for URLs/regions/credentials)
            const infraFields = ['baseUrl', 'region', 'endpoint', 'projectId', 'location',
                                 'deployment', 'apiVersion', 'keepAlive', 'organization'] as const;
            for (const field of infraFields) {
              const envValue = (envProviderConfig as Record<string, any>)[field];
              if (envValue !== undefined && envValue !== '' && envValue !== existingProviderConfig[field]) {
                existingProviderConfig[field] = envValue;
                updated = true;
              }
            }

            // v3 (2026-04-11): clear provider_config.models[] when the
            // seeder version bumps, and reseed from env. The models[]
            // array is normally populated by live SDK discovery, but
            // on a version bump we treat it as stale — if the env has
            // a fresh models list (AZURE_OPENAI_DEPLOYMENTS etc.) the
            // seeder overwrites; if not, it clears to [] so the next
            // admin discover-models action rewrites it cleanly.
            if (envProviderConfig.models !== undefined) {
              existingProviderConfig.models = envProviderConfig.models;
              updated = true;
            } else if (Array.isArray(existingProviderConfig.models)) {
              existingProviderConfig.models = [];
              updated = true;
            }
            // Also drop any cached lastDiscoveryAt so the next call
            // is treated as a fresh discovery rather than a no-op.
            delete existingProviderConfig.lastDiscoveryAt;

            // Stamp seeder version after syncing model/infra fields
            existingProviderConfig.seeder_version = SEEDER_VERSION;
            updated = true;
          }

          // Sync capabilities on every run for non-admin-owned providers.
          // Previously this was never touched after initial create, so
          // Some deployments kept stale capability blocks even after the seeder
          // learned new things — notably azure-openai missing
          // `embeddings: true` when AZURE_OPENAI_EMBEDDING_DEPLOYMENT was
          // set, which broke the embedding provider picker in server.ts.
          if (!isAdminOwned) {
            const existingCapabilities = (existing.capabilities as Record<string, any>) || {};
            const envCapabilities = provider.capabilities || {};
            const mergedCapabilities = { ...existingCapabilities };
            let capsChanged = false;
            for (const key of Object.keys(envCapabilities)) {
              if (existingCapabilities[key] !== envCapabilities[key]) {
                mergedCapabilities[key] = envCapabilities[key];
                capsChanged = true;
              }
            }
            if (capsChanged) {
              (existing as any).capabilities = mergedCapabilities;
              updated = true;
            }
          }

          // Sync auth_config infrastructure fields (credentials, region) — always, even for admin-owned
          const existingAuthConfig = existing.auth_config as Record<string, any> || {};
          const envAuthConfig = provider.authConfig;
          const authInfraFields = ['region', 'projectId', 'serviceAccountPath'] as const;
          for (const field of authInfraFields) {
            const envValue = (envAuthConfig as Record<string, any>)[field];
            if (envValue !== undefined && envValue !== '' && envValue !== existingAuthConfig[field]) {
              existingAuthConfig[field] = envValue;
              updated = true;
            }
          }

          // Sync sensitive auth credentials (only if env var has a real value — skip placeholders and empty)
          const authCredFields = ['apiKey', 'accessKeyId', 'secretAccessKey', 'clientSecret'] as const;
          for (const field of authCredFields) {
            const envValue = (envAuthConfig as Record<string, any>)[field];
            // Skip placeholder values from ESO/Vault that haven't been populated yet
            const isPlaceholder = typeof envValue === 'string' && envValue.includes('placeholder');
            if (envValue && !isPlaceholder && envValue !== existingAuthConfig[field]) {
              existingAuthConfig[field] = envValue;
              updated = true;
            }
          }

          if (updated) {
            await prisma.lLMProvider.update({
              where: { name: provider.name },
              data: {
                model_config: existingModelConfig,
                provider_config: existingProviderConfig,
                auth_config: encryptAuthConfig(existingAuthConfig),
                // Include capabilities sync — the mutated `existing.capabilities`
                // above is what we want to persist. Non-admin-owned providers
                // have their capabilities merged from env on every startup so
                // new capability flags (like embeddings) propagate.
                capabilities: (existing as any).capabilities,
              }
            });
            log.info({
              provider: provider.name,
              envModelConfig,
              updatedFields: Object.keys(envModelConfig).filter(k => envModelConfig[k] && envModelConfig[k] !== (existing.model_config as any)?.[k])
            }, 'Updated existing provider model_config + infra fields from env vars');
          } else {
            log.debug({ provider: provider.name, isAdminOwned }, 'Provider exists, no updates needed');
          }
          skipped++;
          continue;
        }

        // Create the provider (encrypt sensitive credential fields)
        await prisma.lLMProvider.create({
          data: {
            name: provider.name,
            display_name: provider.displayName,
            provider_type: provider.providerType,
            enabled: provider.enabled,
            priority: provider.priority,
            auth_config: encryptAuthConfig(provider.authConfig),
            provider_config: { ...provider.providerConfig, seeder_managed: true, seeder_version: SEEDER_VERSION },
            model_config: provider.modelConfig,
            capabilities: provider.capabilities,
            description: provider.description,
          }
        });

        log.info({ provider: provider.name, type: provider.providerType }, 'Seeded provider from env vars');
        seeded++;
      } catch (err) {
        log.error({ error: err, provider: provider.name }, 'Failed to seed provider');
      }
    }

    log.info({ seeded, skipped, total: providers.length }, 'LLM provider seeding complete');

  } catch (error) {
    log.error({ error }, 'Failed to seed LLM providers');
  }
}
