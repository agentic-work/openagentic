import { loggers } from '../utils/logger.js';
import { ProviderManager, setProviderManager, subscribeProviderReload } from '../services/llm-providers/ProviderManager.js';
import { ProviderConfigService } from '../services/llm-providers/ProviderConfigService.js';
import ModelCapabilityRegistry, { setModelCapabilityRegistry } from '../services/ModelCapabilityRegistry.js';
import { ModelHealthCheckService } from '../services/ModelHealthCheck.js';
import { SmartModelRouter, setSmartModelRouter } from '../services/SmartModelRouter.js';
import { RouterTuningService } from '../services/RouterTuningService.js';
import { getRedisClient } from '../utils/redis-client.js';
import { prisma } from '../utils/prisma.js';
import type { BootstrapStep } from './types.js';

export const INIT_PROVIDERS: BootstrapStep = {
  name: 'providers-init',
  critical: false,
  async run({ ctx }) {
    loggers.services.info('Initializing LLM Provider Manager...');
    try {
      const configService = new ProviderConfigService(loggers.services);
      const config = await configService.loadProviderConfig();
      ctx.providerManager = new ProviderManager(loggers.services, config);
      await ctx.providerManager.initialize();

      setProviderManager(ctx.providerManager);
      subscribeProviderReload(loggers.services).catch(() => {});

      loggers.services.info('LLM Provider Manager initialized successfully');

      // ModelRouter shadow mode
      try {
        const { initializeModelRouter } = await import('../services/model-routing/index.js');
        initializeModelRouter({ prisma, logger: loggers.services });
        loggers.services.info('ModelRouter (shadow mode) initialized');
      } catch (err) {
        loggers.services.warn({ err }, 'ModelRouter init failed — shadow mode disabled (routing unaffected)');
      }

      // Model Capability Registry
      loggers.services.info('Initializing Model Capability Registry for pricing and capabilities...');
      try {
        const modelCapabilityRegistry = new ModelCapabilityRegistry(loggers.services, prisma);
        await modelCapabilityRegistry.initialize();
        setModelCapabilityRegistry(modelCapabilityRegistry);
        const allModels = modelCapabilityRegistry.getAllModels();
        loggers.services.info({
          cachedModels: allModels.length,
          modelsWithPricing: allModels.filter(m => m.inputCostPer1k !== undefined).length
        }, '✅ Model Capability Registry initialized - costs will be tracked accurately');
      } catch (registryError) {
        loggers.services.warn({ err: registryError }, 'Model Capability Registry initialization failed - using fallback pricing');
      }

      // Model Health Check
      ctx.modelHealthCheck = new ModelHealthCheckService(loggers.services, ctx.providerManager!);
      loggers.services.info('Model Health Check Service initialized with ProviderManager');

      // Phase E.1 (2026-05-10) — classifier-instantiation REMOVED.
      // Spec §50: "Three plain functions. No registry. No composer. No
      // priority sort. No intent filter." The model decides; pre-LLM
      // classification is forbidden. SmartModelRouter receives no
      // classifier and routes purely on FCA scoring.
      //
      // RouterTuning.intentClassifierEnabled / .intentClassifierModelId
      // columns remain in the schema (dead config) until Phase E.5
      // migration drops them. Reads are gone, writes via admin UI are
      // harmless.

      // Smart Model Router
      try {
        ctx.smartModelRouter = new SmartModelRouter(loggers.services, {
          providerManager: ctx.providerManager!,
        });
        await ctx.smartModelRouter.initialize();
        setSmartModelRouter(ctx.smartModelRouter);

        const models = ctx.smartModelRouter.getAllModels();
        loggers.services.info({
          modelCount: models.length,
          models: models.map(m => ({
            id: m.modelId,
            provider: m.provider,
            cost: `$${m.cost.inputPer1kTokens}/1k tokens`,
            functionCalling: m.capabilities.functionCalling ? `${(m.capabilities.functionCallingAccuracy * 100).toFixed(0)}%` : 'N/A'
          }))
        }, '✅ Smart Model Router initialized - Ollama preferred for simple queries (FREE)');

        // Pre-warm Ollama model — only when OLLAMA_WARMUP_MODEL is explicitly set.
        // Per CLAUDE.md no-hardcoded-models rule: no fallback literal; skip if unset.
        // Set OLLAMA_WARMUP_MODEL=<tag> in helm values to enable warm-up.
        const warmupModel = process.env.OLLAMA_WARMUP_MODEL;
        if (warmupModel) {
          try {
            const warmStart = Date.now();
            await ctx.providerManager!.createCompletion({
              model: warmupModel,
              messages: [{ role: 'user', content: 'hi' }],
              max_tokens: 1,
              stream: false,
            });
            loggers.services.info({ warmupMs: Date.now() - warmStart, model: warmupModel },
              '🔥 Ollama model pre-warmed — first user request will be fast');
          } catch (warmErr: any) {
            loggers.services.warn({ error: warmErr?.message, model: warmupModel },
              '⚠️ Ollama warm-up failed (non-fatal) — first request will be slower');
          }
        } else {
          loggers.services.info('Ollama warm-up skipped (OLLAMA_WARMUP_MODEL not set)');
        }

        // Schedule periodic feedback ingestion
        setTimeout(() => {
          ctx.smartModelRouter?.updateFromFeedback(prisma).catch(() => {});
        }, 60_000);
        setInterval(() => {
          ctx.smartModelRouter?.updateFromFeedback(prisma).catch(() => {});
        }, 30 * 60_000);

      } catch (routerError) {
        loggers.services.warn({ err: routerError }, 'Smart Model Router initialization failed - using default model selection');
      }

      // RegistrySyncJob
      try {
        const { RegistrySyncJob, setRegistrySyncJob } = await import('../services/model-routing/RegistrySyncJob.js');
        const syncJob = new RegistrySyncJob({
          prisma: prisma as any,
          providerManager: {
            getProvider: (name: string) => (ctx.providerManager as any)?.providers?.get(name) ?? null,
          },
          logger: loggers.services,
          intervalMs: 30_000,
        });
        syncJob.start();
        setRegistrySyncJob(syncJob);
        loggers.services.info('RegistrySyncJob started (30s interval, Ollama + AIF only)');
      } catch (syncErr) {
        loggers.services.warn({ err: syncErr }, 'RegistrySyncJob start failed — Registry will not auto-sync');
      }

    } catch (error) {
      loggers.services.warn({ err: error }, 'LLM Provider Manager initialization failed - title generation will be disabled');
    }

    // AgentRegistry — seed default agents
    try {
      const { AgentRegistry } = await import('../services/AgentRegistry.js');
      const agentRegistry = new AgentRegistry();
      await agentRegistry.initialize();
      loggers.services.info('AgentRegistry initialized — default agents seeded to database');
    } catch (agentErr) {
      loggers.services.warn({ err: agentErr }, 'AgentRegistry initialization failed — agents may need manual seeding');
    }

    // Flows Expert meta-agent — seeded into SOT, available to flows + AI right-rail.
    try {
      const { seedFlowsExpertAgent } = await import('../services/__seed__/agents/flowsExpertAgent.js');
      const id = await seedFlowsExpertAgent();
      if (id) loggers.services.info({ agentId: id }, 'Flows Expert agent seeded');
    } catch (fxErr) {
      loggers.services.warn({ err: fxErr }, 'Flows Expert agent seed failed — meta-agent unavailable');
    }

    // Workflow templates auto-seed
    try {
      const { autoSeedWorkflowTemplates } = await import('../routes/workflows.js');
      if (typeof autoSeedWorkflowTemplates === 'function') {
        const result = await autoSeedWorkflowTemplates();
        loggers.services.info(
          { created: result.created, updated: result.updated, skipped: result.skipped },
          '✅ Workflow templates seeded (auto)'
        );
      }
    } catch (tplErr) {
      loggers.services.warn({ err: tplErr }, 'Workflow template auto-seed failed — flows workspace may be empty');
    }

    // DLP Scanner
    try {
      const { initializeDLPScanner } = await import('../services/DLPScannerService.js');
      const dlpScanner = await initializeDLPScanner(loggers.services);
      // getDLPScannerInstance() returns the same instance (set by initializeDLPScanner)
      const rules = dlpScanner.getRules();
      const enabled = rules.filter((r: any) => r.enabled).length;
      loggers.services.info({ totalRules: rules.length, enabledRules: enabled }, 'DLP Scanner initialized with persisted config');
    } catch (dlpErr) {
      loggers.services.warn({ err: dlpErr }, 'DLP Scanner initialization failed — scanning disabled');
    }

    // LLM provider seeding (runs after route registration; kept here as post-provider step)
    try {
      const { seedLLMProviders } = await import('../services/LLMProviderSeeder.js');
      await seedLLMProviders();
      loggers.services.info('LLM provider seeding complete');

      // Registry SoT v1 — idempotent bootstrap seeder (F2.5).
      // Replaces the legacy boot-time write seeders (retired in F2.3/F2.4).
      // Gates on SEEDER_VERSION so warm restarts are true no-ops and admin
      // edits to model_role_assignments are preserved across helm upgrades.
      try {
        const { seedRegistryFromHelm } = await import('../services/model-routing/RegistryBootstrapSeeder.js');
        const { prisma: p } = await import('../utils/prisma.js');
        const result = await seedRegistryFromHelm({ prisma: p as any, logger: loggers.services });
        loggers.services.info(result, 'Registry bootstrap seeding complete (RegistryBootstrapSeeder)');
      } catch (err: any) {
        loggers.services.warn({ error: err?.message }, 'RegistryBootstrapSeeder failed — Registry will show only admin-added rows; admin UI can seed manually');
      }

      // Secondary Ollama chat provider (wizard "Both" strategy). Additive +
      // idempotent: lands an Ollama provider row + role='chat' assignment at a
      // LOWER precedence than the Bedrock bootstrap (priority 10) so Claude
      // Sonnet 4.6 stays the default while gpt-oss:20b becomes a selectable
      // second chat model. No-op unless OLLAMA_ENABLED=true + OLLAMA_CHAT_MODEL
      // set + a non-Ollama bootstrap provider exists.
      try {
        loggers.services.info('Invoking seedSecondaryOllamaProvider (boot step) — second chat model under "Both"');
        const { seedSecondaryOllamaProvider } = await import('../services/LLMProviderSeeder.js');
        await seedSecondaryOllamaProvider();
        loggers.services.info('seedSecondaryOllamaProvider boot step returned');
      } catch (err: any) {
        loggers.services.warn({ error: err?.message }, 'seedSecondaryOllamaProvider failed — second chat model absent; admin can add via UI');
      }

      // Task #360 — ensure at least one role=code row exists. Runs even when
      // BOOTSTRAP_PROVIDER is disabled (no helm-seeded provider) so an admin
      // who manually added a chat model via the UI still gets a populated
      // /model picker. Idempotent + FK-safe — see CodeRoleBackfillService.
      try {
        const { CodeRoleBackfillService } = await import('../services/model-routing/CodeRoleBackfillService.js');
        const { prisma: p } = await import('../utils/prisma.js');
        const backfiller = new CodeRoleBackfillService(p as any, loggers.services);
        const result = await backfiller.backfill();
        loggers.services.info(result, '[CodeRoleBackfill] boot-time backfill complete');
      } catch (err: any) {
        loggers.services.warn({ error: err?.message }, 'CodeRoleBackfillService failed — /model picker may be empty');
      }

      // 2026-05-24 — seed the first-class function_calling_accuracy column from
      // the ModelCapabilityRegistry benchmark table for any registry row that
      // still has it NULL. Without this every model scores FCA=0, fails every
      // RouterTuning floor, and the router can't select on capability or route
      // DOWN to a cheap model. Idempotent — only NULL rows are touched.
      try {
        const { ModelFcaBackfillService } = await import('../services/model-routing/ModelFcaBackfillService.js');
        const { getModelCapabilityRegistry } = await import('../services/ModelCapabilityRegistry.js');
        const { prisma: p } = await import('../utils/prisma.js');
        const mcr = getModelCapabilityRegistry();
        const fcaLookup = (modelId: string): number | null => {
          try {
            const caps = mcr?.getCapabilities(modelId);
            return typeof caps?.functionCallingAccuracy === 'number' ? caps.functionCallingAccuracy : null;
          } catch {
            return null;
          }
        };
        const fcaBackfiller = new ModelFcaBackfillService(p as any, loggers.services, fcaLookup);
        const fcaResult = await fcaBackfiller.backfill();
        loggers.services.info(fcaResult, '[ModelFcaBackfill] boot-time FCA seed complete');

        // CRITICAL ORDERING: SmartModelRouter.initialize() (above) built its
        // in-memory profiles BEFORE this backfill seeded the FCA column, so
        // those profiles carry FCA=0. Rebuild them now so the live router
        // scores on the seeded FCA — otherwise the column is correct in the DB
        // but the running router still filters every model at FCA=0 until the
        // next provider-add or pod restart.
        if (fcaResult.updated > 0 && ctx.smartModelRouter) {
          try {
            await ctx.smartModelRouter.reload();
            loggers.services.info('[ModelFcaBackfill] SmartModelRouter reloaded — profiles now carry seeded FCA');
          } catch (reloadErr: any) {
            loggers.services.warn({ error: reloadErr?.message }, '[ModelFcaBackfill] router reload after FCA seed failed — restart pod to pick up FCA');
          }
        }
      } catch (err: any) {
        loggers.services.warn({ error: err?.message }, 'ModelFcaBackfillService failed — router FCA scoring may stay at 0 until admin sets values');
      }

      // V3 Phase 5 — EnrichedTool registry seeder. Lands ~14 default T1
      // tool metadata rows (outputTemplate + truncate_summary template +
      // schemas) on first boot. Idempotent: subsequent boots refresh
      // structural fields but preserve admin-set `enabled` flags.
      try {
        const { EnrichedToolService } = await import('../services/EnrichedToolService.js');
        const { seedEnrichedTools } = await import('../services/EnrichedToolSeeder.js');
        const { prisma: p } = await import('../utils/prisma.js');
        const svc = new EnrichedToolService(p as any);
        await seedEnrichedTools(svc);
      } catch (err: any) {
        loggers.services.warn(
          { error: err?.message },
          'EnrichedToolSeeder failed — V3 envelope splitter will fall back to default outputTemplate (none)',
        );
      }

      // Load embedding config from DB
      try {
        const { setDbEmbeddingConfig } = await import('../services/UniversalEmbeddingService.js');
        const { mapLlmProviderTypeToEmbeddingProvider } = await import(
          '../services/llm-providers/embeddingProviderTypeMap.js'
        );
        const envProviderAliases: Record<string, string> = {
          'azure': 'azure-openai', 'azureopenai': 'azure-openai', 'azure-openai': 'azure-openai',
          'aws': 'aws-bedrock', 'bedrock': 'aws-bedrock', 'aws-bedrock': 'aws-bedrock',
          'gcp': 'vertex-ai', 'vertex': 'vertex-ai', 'vertex-ai': 'vertex-ai',
          'ollama': 'ollama',
          'openai': 'openai-compatible', 'openai-compatible': 'openai-compatible',
        };
        const envRequested = process.env.EMBEDDING_PROVIDER?.toLowerCase();
        const envResolvedType = envRequested ? envProviderAliases[envRequested] : undefined;

        const candidates = await prisma.lLMProvider.findMany({
          where: { enabled: true },
          orderBy: { priority: 'asc' },
        });
        const embeddingCapable = candidates.filter(p => {
          const caps = (p.capabilities as Record<string, any>) || {};
          const mc = (p.model_config as Record<string, any>) || {};
          return caps.embeddings === true && mc.embeddingModel;
        });

        const envMatch = envResolvedType
          ? embeddingCapable.find(p => p.provider_type === envResolvedType)
          : undefined;
        const nonOllama = embeddingCapable.find(p => p.provider_type !== 'ollama');
        const embeddingProvider = envMatch || nonOllama || embeddingCapable[0];

        if (embeddingProvider) {
          const mc = (embeddingProvider.model_config as Record<string, any>) || {};
          const pc = (embeddingProvider.provider_config as Record<string, any>) || {};
          const embProvider = mapLlmProviderTypeToEmbeddingProvider(embeddingProvider.provider_type);
          setDbEmbeddingConfig({
            provider: embProvider as any,
            ollamaBaseUrl: pc.baseUrl,
            ollamaModel: mc.embeddingModel,
            gcpProjectId: pc.projectId,
            gcpLocation: pc.location || pc.region,
            gcpModel: mc.embeddingModel,
            azureEndpoint: pc.baseUrl || pc.endpoint,
            azureDeployment: mc.embeddingModel,
            endpoint: pc.baseUrl,
            model: mc.embeddingModel,
            dimensions: pc.embeddingDimensions ? parseInt(pc.embeddingDimensions) : undefined,
          });
          loggers.services.info({
            provider: embProvider,
            model: mc.embeddingModel,
            source: envMatch ? 'env-matched' : (nonOllama ? 'non-ollama-preferred' : 'first-capable'),
            envRequested: envRequested || null,
            embeddingCapableCount: embeddingCapable.length,
          }, '✅ DB-backed embedding config loaded');
        } else {
          loggers.services.warn({
            envRequested: envRequested || null,
            totalEnabledProviders: candidates.length,
          }, '⚠️ No embedding-capable provider in DB — UniversalEmbeddingService will fall back to env vars');
        }
      } catch (dbEmbErr) {
        loggers.services.debug({ err: dbEmbErr }, 'Could not load DB embedding config (will use env vars)');
      }
    } catch (err) {
      loggers.services.warn({ err }, 'LLM provider seeding failed - continuing with existing DB config');
    }

    // Pipeline Hook System
    try {
      loggers.services.info('Initializing Pipeline Hook System...');
      const { initializeHookRunner } = await import('../pipeline/hooks.js');
      const { registerBuiltInHooks } = await import('../pipeline/built-in-hooks.js');
      const hookRunner = initializeHookRunner(loggers.services);
      registerBuiltInHooks(hookRunner, loggers.services);
      loggers.services.info('Pipeline Hook System initialized — hooks active');
    } catch (err) {
      loggers.services.warn({ err }, 'Pipeline Hook System init failed — continuing without hooks');
    }
  },
};
