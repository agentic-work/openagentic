import { PipelineStage, PipelineContext } from './pipeline.types.js';
import { getToolSuccessTrackingService } from '../../../services/ToolSuccessTrackingService.js';
import { getIntentLinkingService } from '../../../services/IntentLinkingService.js';
import { mcpAccessControlService } from '../../../services/MCPAccessControlService.js';
import { getToolPgvectorSearchService } from '../../../services/ToolPgvectorSearchService.js';
// Data layer tools: query_data and list_datasets allow LLM to drill into
// large tool results stored by DataLayerService (>16KB auto-stored)
import { getDataLayerTools } from '../../../services/DataQueryTool.js';
import { getSynthToolDefinitions, isSynthVisibleToLLM } from './synth-execution.helper.js';
import { getMemoryToolDefinitions } from '../../../services/AgentMemoryService.js';
// TODO: System MCPs moved to MCP Proxy (oap-diagram-mcp) - keeping import for future use
// import { getSystemMcpTools, isDiagramRequest } from '../../../services/system-mcps/index.js';

/**
 * MCP Stage - Semantic tool selection for LLM context
 *
 * SINGLE SOURCE OF TRUTH: PostgreSQL pgvector
 *   - ACID-consistent tool embeddings with HNSW index
 *   - Intent-priority routing (ACTION vs CONTENT servers)
 *   - Score-gap cutoff (only sends relevant tools, not noise)
 *   - This is the ONLY store the LLM should ever query
 *
 * FALLBACK (degraded mode only):
 *   - Milvus: GPU-accelerated vector search if pgvector is DOWN
 *   - Redis: Emergency all-tools dump if BOTH vector stores are DOWN
 *   - These are NOT independent sources — they exist for resilience only
 */
export class MCPStage implements PipelineStage {
  readonly name = 'mcp';
  readonly priority = 40;

  constructor() {
    // Service is a singleton, accessed via global.toolSemanticCache global instance
  }

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const startTime = Date.now();

    try {
      context.logger.info({
        startTime: new Date().toISOString(),
        sessionId: context.request.sessionId,
        userId: context.user.id,
        enableMCP: context.config.enableMCP,
        messageCount: context.messages.length
      }, '[MCP] 🚀 Starting MCP tool search stage with super verbose logging');

      if (!context.config.enableMCP) {
        context.logger.info('[MCP] ⚠️ MCP disabled in config, skipping tool search');
        context.availableTools = [];
        return context;
      }

      // Get user query for semantic search
      context.logger.info('[MCP] 📝 Extracting user query for semantic tool search...');
      const userQuery = this.extractUserQuery(context);

      context.logger.info({
        hasQuery: !!userQuery,
        queryLength: userQuery?.length || 0,
        queryPreview: userQuery?.substring(0, 100) || 'NO_QUERY',
        messagesAvailable: context.messages.length,
        lastMessageRole: context.messages[context.messages.length - 1]?.role
      }, '[MCP] 🔍 User query extraction results');

      if (!userQuery) {
        context.logger.warn('[MCP] ❌ No user query found for tool search - cannot perform semantic search');
        context.availableTools = [];
        return context;
      }

      context.logger.info({
        query: userQuery.substring(0, 100),
        queryLength: userQuery.length,
        toolSemanticCacheInitialized: global.toolSemanticCache?.isInitialized || false,
        hasToolSemanticCache: !!global.toolSemanticCache
      }, '[MCP] 🚀 Starting SEMANTIC tool search via ToolSemanticCacheService');

      // PERFORMANCE OPTIMIZATION: Skip learning services (saves 4+ embedding calls / 60+ seconds)
      // The main semantic search is sufficient for finding relevant tools.
      // Learning services can be re-enabled later with proper embedding caching.
      // const learnedToolNames = await this.getLearnedToolsForQuery(context, userQuery);
      const learnedToolNames: string[] = []; // Skipped for performance

      // =====================================================================
      // INTELLIGENT TOOL SELECTION: Server-First Routing + Score-Gap Cutoff
      // =====================================================================
      // Layer 1: Classify query → target servers (reduces 163 → 8-30 candidates)
      // Layer 2: pgvector semantic search with server filter + score-gap cutoff
      // Layer 3: Hard ceiling (never send > MAX_TOOLS to LLM)
      // Fallback: Milvus → Redis if pgvector unavailable
      // =====================================================================
      const MAX_TOOLS = 15; // Hard ceiling — LLMs perform BETTER with fewer, more relevant tools
      let relevantTools: any[] = [];
      let searchMethod = 'none';
      let targetServers: string[] = [];

      // 1. PRIMARY: pgvector with intent-priority routing + score-gap detection
      const pgvectorService = getToolPgvectorSearchService();
      if (pgvectorService?.isReady()) {
        try {
          // Layer 1: Intent-priority routing — distinguish ACTION from CONTENT
          const intentRouting = pgvectorService.detectTargetServersWithIntent(userQuery);
          const hasPrimary = intentRouting.primary.length > 0;
          const hasContext = intentRouting.context.length > 0;
          targetServers = [...intentRouting.primary, ...intentRouting.context];
          const hasServerFilter = targetServers.length > 0;

          context.logger.info({
            query: userQuery.substring(0, 200),
            primaryServers: intentRouting.primary,
            contextServers: intentRouting.context,
            searchTier: 'pgvector_primary',
            routing: hasPrimary ? 'intent-priority' : hasServerFilter ? 'server-first' : 'broad'
          }, '[MCP] 🔍 PRIMARY: pgvector search with intent-priority routing');

          if (hasPrimary) {
            // INTENT-PRIORITY: Search primary servers FIRST with full topK
            const primaryTools = await pgvectorService.searchToolsAsOpenAIFunctions(
              userQuery, MAX_TOOLS,
              { serverIds: intentRouting.primary, applyScoreGap: true }
            );

            // Primary server tools get 2x similarity boost for ranking
            for (const tool of primaryTools) {
              if ((tool as any)._similarity) {
                (tool as any)._similarity *= 2.0;
              }
            }

            relevantTools = [...primaryTools];

            // Search context servers with small topK (supplementary only)
            if (hasContext && relevantTools.length < MAX_TOOLS) {
              const contextTopK = Math.min(3, MAX_TOOLS - relevantTools.length);
              const contextTools = await pgvectorService.searchToolsAsOpenAIFunctions(
                userQuery, contextTopK,
                { serverIds: intentRouting.context, applyScoreGap: false }
              );
              const existingNames = new Set(relevantTools.map((t: any) => t.function?.name));
              for (const tool of contextTools) {
                if (!existingNames.has(tool.function?.name)) {
                  relevantTools.push(tool);
                }
              }
            }
          } else {
            // No explicit action verb — use standard server-first routing
            const RETRIEVAL_K = hasServerFilter ? 25 : 40;
            relevantTools = await pgvectorService.searchToolsAsOpenAIFunctions(
              userQuery, RETRIEVAL_K,
              { serverIds: hasServerFilter ? targetServers : undefined, applyScoreGap: true }
            );
          }

          searchMethod = 'pgvector';

          context.logger.info({
            resultCount: relevantTools.length,
            searchMethod,
            intentPriority: hasPrimary,
            topSimilarity: (relevantTools[0] as any)?._similarity?.toFixed(3),
            bottomSimilarity: (relevantTools[relevantTools.length - 1] as any)?._similarity?.toFixed(3),
            toolNames: relevantTools.slice(0, 5).map((t: any) => t.function?.name)
          }, '[MCP] pgvector search returned tools');

          // MULTI-SERVER FAIRNESS: When multiple servers matched and no primary intent,
          // ensure each server has at least 2 tools.
          if (!hasPrimary && hasServerFilter && targetServers.length > 1) {
            const toolsByServer = new Map<string, any[]>();
            for (const tool of relevantTools) {
              const sid = tool._serverId || tool.serverId || '';
              if (!toolsByServer.has(sid)) toolsByServer.set(sid, []);
              toolsByServer.get(sid)!.push(tool);
            }
            const MIN_PER_SERVER = 2;
            const missingServers = targetServers.filter(s => (toolsByServer.get(s)?.length || 0) < MIN_PER_SERVER);
            if (missingServers.length > 0) {
              for (const serverId of missingServers) {
                try {
                  const supplementary = await pgvectorService.searchToolsAsOpenAIFunctions(
                    userQuery, MIN_PER_SERVER,
                    { serverIds: [serverId], applyScoreGap: false }
                  );
                  const existingNames = new Set(relevantTools.map((t: any) => t.function?.name));
                  for (const tool of supplementary) {
                    if (!existingNames.has(tool.function?.name)) {
                      relevantTools.push(tool);
                    }
                  }
                } catch (e: any) {
                  context.logger.warn({ serverId, error: e.message }, '[MCP] Supplementary search failed');
                }
              }
            }
          }
        } catch (pgError: any) {
          context.logger.warn({ error: pgError.message }, '[MCP] pgvector search failed, trying Milvus fallback');
        }
      }

      // 2. FALLBACK: Milvus — ONLY if pgvector returned 0 results (degraded mode)
      if (relevantTools.length === 0 && global.toolSemanticCache?.isInitialized) {
        try {
          context.logger.warn({
            query: userQuery.substring(0, 200),
            topK: MAX_TOOLS,
            searchTier: 'milvus_fallback',
            reason: 'pgvector returned 0 results or unavailable'
          }, '[MCP] ⚠️ DEGRADED MODE: Falling back to Milvus (pgvector is the single source of truth)');

          relevantTools = await global.toolSemanticCache.searchToolsAsOpenAIFunctions(userQuery, MAX_TOOLS);
          searchMethod = 'milvus_fallback';

          context.logger.warn({
            resultCount: relevantTools.length,
            searchMethod
          }, '[MCP] Milvus fallback returned tools — investigate why pgvector failed');
        } catch (error: any) {
          context.logger.error({ error: error.message }, '[MCP] Milvus fallback also failed');
        }
      }

      // pgvector is the single source of truth. If it returns 0 tools, something is wrong
      // with indexing — Milvus/Redis are emergency fallbacks, not alternatives.

      // Layer 3: Hard ceiling — never exceed MAX_TOOLS from semantic search
      if (relevantTools.length > MAX_TOOLS) {
        const beforeCeiling = relevantTools.length;
        relevantTools = relevantTools.slice(0, MAX_TOOLS);
        context.logger.info({
          beforeCeiling,
          afterCeiling: MAX_TOOLS,
          removed: beforeCeiling - MAX_TOOLS
        }, '[MCP] 🔒 HARD CEILING: Trimmed tools to max limit');
      }

      // TOOL CATEGORIZATION: Prefix tool descriptions with server category for LLM context
      const CATEGORY_MAP: Record<string, string> = {
        openagentic_kubernetes: 'K8s', openagentic_azure: 'Azure', openagentic_aws: 'AWS',
        openagentic_gcp: 'GCP', openagentic_web: 'Web', openagentic_admin: 'Platform',
        openagentic_github: 'GitHub', openagentic_prometheus: 'Monitoring', openagentic_loki: 'Logs',
        openagentic_memory: 'Memory', openagentic_diagram: 'Diagrams',
        openagentic_openagentic: 'Code',
      };
      for (const tool of relevantTools) {
        const serverName = tool._serverName || tool._serverId || '';
        const cat = CATEGORY_MAP[serverName];
        if (cat && tool.function?.description) {
          tool.function.description = `[${cat}] ${tool.function.description}`;
        }
      }

      context.logger.info({
        semanticToolsFound: relevantTools.length,
        toolNames: relevantTools.slice(0, 10).map((t: any) => t?.function?.name || 'UNNAMED'),
        searchMethod,
        intentBased: true,
        learningApplied: learnedToolNames.length > 0
      }, '[MCP] SEMANTIC SEARCH COMPLETE: Found tools via ' + searchMethod);

      // 3. LAST RESORT: Redis cache — EMERGENCY ONLY (dumps ALL tools, no semantic filtering)
      if (relevantTools.length === 0) {
        context.logger.error({
          query: userQuery.substring(0, 100),
          reason: 'BOTH pgvector AND Milvus returned zero tools',
          fallbackMethod: 'REDIS_EMERGENCY_ALL_TOOLS',
          action: 'CHECK INDEXING — pgvector is the single source of truth and it failed'
        }, '[MCP] 🚨 EMERGENCY FALLBACK: Redis all-tools dump (no semantic filtering — degraded quality)');

        relevantTools = await this.getStaticToolsFromRedis(context);
        searchMethod = 'redis_emergency';
      }

      // 🎛️ USER PREFERENCE FILTERING: Filter tools based on user's enabled/disabled settings
      // The frontend sends enabledTools array with format: ["serverId.toolName", "serverId", ...]
      // If a server is disabled, all its tools are excluded
      // If a specific tool is disabled, only that tool is excluded
      const enabledToolsFilter = context.request.enabledTools;

      if (enabledToolsFilter && enabledToolsFilter.length > 0) {
        const beforeCount = relevantTools.length;

        // Build sets for quick lookup
        const enabledServers = new Set<string>();
        const enabledToolKeys = new Set<string>();
        const disabledToolKeys = new Set<string>(); // Track explicitly disabled tools

        for (const entry of enabledToolsFilter) {
          if (entry.includes('.')) {
            // It's a specific tool: "serverId.toolName"
            enabledToolKeys.add(entry);
          } else {
            // It's a server ID
            enabledServers.add(entry);
          }
        }

        // Filter tools based on user preferences
        relevantTools = relevantTools.filter(tool => {
          const toolName = tool.function?.name || '';
          // Handle various serverId field names from different sources
          const serverId = tool._serverId || tool.serverId || tool.function?.server_name || '';
          const toolKey = `${serverId}.${toolName}`;

          // If server is enabled, check if this specific tool is enabled
          if (enabledServers.has(serverId)) {
            return enabledToolKeys.has(toolKey);
          }

          // Server not in enabled list means all its tools are disabled
          return false;
        });

        context.logger.info({
          enabledServersCount: enabledServers.size,
          enabledServers: Array.from(enabledServers),
          enabledToolsCount: enabledToolKeys.size,
          beforeFilterCount: beforeCount,
          afterFilterCount: relevantTools.length,
          removedCount: beforeCount - relevantTools.length,
          remainingTools: relevantTools.slice(0, 5).map(t => t.function?.name)
        }, '[MCP] 🎛️ USER PREFERENCE: Filtered tools based on user-enabled servers/tools');
      }

      // 🛡️ MCP ACCESS CONTROL: Filter tools based on policy-based access control
      // This enforces per-MCP access policies configured in the admin portal
      const beforeAccessControl = relevantTools.length;
      relevantTools = await mcpAccessControlService.filterTools(
        context.user.id,
        context.user.groups || [],
        context.user.isAdmin || false,
        relevantTools,
        context.logger
      );

      if (relevantTools.length < beforeAccessControl) {
        context.logger.warn({
          userId: context.user.id,
          userGroups: context.user.groups,
          beforeFilterCount: beforeAccessControl,
          afterFilterCount: relevantTools.length,
          removedCount: beforeAccessControl - relevantTools.length,
          remainingTools: relevantTools.slice(0, 5).map(t => t.function?.name)
        }, '[MCP] 🛡️ ACCESS CONTROL: Removed tools based on MCP access policies');
      } else {
        context.logger.info({
          userId: context.user.id,
          toolCount: relevantTools.length
        }, '[MCP] 🛡️ ACCESS CONTROL: All tools passed policy check');
      }

      // =================================================================
      // 🧪 SYNTH (TOOL SYNTHESIS): Add dynamic tool synthesis capability
      // =================================================================
      // Include Synth tool so LLM can synthesize tools on-demand for tasks
      // outside built-in capabilities. Synth runs AS the authenticated user.
      //
      // Synth visibility is controlled by TWO settings:
      // - enabled: Master switch (from env SYNTH_ENABLED)
      // - visibleToLLM: Whether LLM can see/use Synth (configurable in admin)
      //
      // This allows admins to:
      // - enabled=true, visibleToLLM=true: Synth works normally
      // - enabled=true, visibleToLLM=false: Synth enabled but hidden from LLM
      // - enabled=false: Synth completely disabled
      // Only inject synth for complex queries that have MCP tools.
      // Skip for simple queries (math, greetings) — synth causes Gemini to waste rounds.
      const synthVisibleToLLM = isSynthVisibleToLLM(context.logger);
      const isSimple = this.isSimpleConversationalMessage(userQuery);
      // Synth/OAT is ALWAYS available when enabled — it's the sandbox execution tool
      // for file processing, data transforms, and custom code that no MCP handles.
      // Previously gated on hasMCPTools, but that prevented synth from appearing
      // for pure file processing queries with no MCP tool matches.
      if (synthVisibleToLLM && !isSimple) {
        const synthTools = getSynthToolDefinitions();
        relevantTools = [...relevantTools, ...synthTools];
        context.logger.info({
          synthToolCount: synthTools.length,
          totalTools: relevantTools.length
        }, '[MCP] Synth/OAT: Sandbox execution tool injected');
      } else {
        context.logger.debug({
          reason: !synthVisibleToLLM ? 'Synth not visible to LLM (disabled or visibleToLLM=false)' :
            'Simple query detected — skipping synth'
        }, '[MCP] Synth: Skipped');
      }

      // NOTE: Agent delegation tool (delegate_to_agents) is now injected by agents.stage.ts
      // which runs after this MCP stage. The old spawn_parallel_agents tool has been replaced.

      // SMART TOOL ATTACHMENT: Strip tools for simple queries to enable Ollama routing
      // This is CRITICAL for the TaskAnalysisService routing to work:
      // - hasTools=true → routes to Gemini/Claude (expensive)
      // - hasTools=false → routes to Ollama (FREE) if ROUTE_SIMPLE_TO_OLLAMA=true
      //
      // CRITICAL FIX: NEVER strip tools for Ollama models!
      // Ollama models (including gpt-oss) support native tool calling.
      // If we strip tools here, Ollama cannot call ANY tools at all.
      // Check BOTH context.config.model (pipeline config) AND context.request.model (user's selection)
      const configuredModel = context.config.model || context.request.model || process.env.LLM_DEFAULT_MODEL || '';
      const requestedModel = context.request.model || '';
      const isOllamaModel = configuredModel.toLowerCase().includes('ollama') ||
                           configuredModel.toLowerCase().includes('gpt-oss') ||
                           configuredModel.toLowerCase().includes('llama') ||
                           configuredModel.toLowerCase().includes('mistral') ||
                           configuredModel.toLowerCase().includes('qwen') ||
                           configuredModel.toLowerCase().includes('deepseek') ||
                           requestedModel.toLowerCase().includes('ollama') ||
                           requestedModel.toLowerCase().includes('gpt-oss') ||
                           requestedModel.toLowerCase().includes('llama') ||
                           requestedModel.toLowerCase().includes('mistral') ||
                           requestedModel.toLowerCase().includes('qwen') ||
                           requestedModel.toLowerCase().includes('deepseek');

      // Also check ENABLE_SMART_TOOL_STRIP env var - default to FALSE to preserve tools
      // Set to 'true' only if you're sure simple queries don't need tools
      const enableSmartToolStrip = process.env.ENABLE_SMART_TOOL_STRIP === 'true';

      const isSimpleConversationalRequest = this.isSimpleConversationalMessage(userQuery);

      // Skip tool stripping if:
      // 1. Model is Ollama (gpt-oss, llama, etc.) - supports native tool calling
      // 2. Smart tool strip is disabled (ENABLE_SMART_TOOL_STRIP !== 'true')
      // 3. Query is not simple
      if (isOllamaModel) {
        context.logger.info({
          query: userQuery.substring(0, 100),
          configuredModel,
          requestedModel,
          toolCount: relevantTools.length,
          reason: '🔧 Ollama model detected → tools PRESERVED for native tool calling'
        }, '[MCP] 🛠️ Ollama: Tools preserved (required for native tool calling)');
      } else if (!enableSmartToolStrip) {
        context.logger.info({
          query: userQuery.substring(0, 100),
          toolCount: relevantTools.length,
          enableSmartToolStrip,
          reason: 'ENABLE_SMART_TOOL_STRIP=false → tools preserved'
        }, '[MCP] 🛠️ Tools preserved (smart stripping disabled)');
      } else if (isSimpleConversationalRequest) {
        const beforeFilterCount = relevantTools.length;
        // For simple queries, remove ALL tools to enable Ollama routing
        relevantTools = [];

        context.logger.info({
          query: userQuery.substring(0, 100),
          isSimpleMessage: true,
          beforeFilterCount,
          afterFilterCount: 0,
          routingImpact: 'hasTools will be FALSE → enables Ollama routing in TaskAnalysisService',
          reason: '🆓 SMART TOOL STRIP: Simple query detected → tools removed → Ollama routing enabled'
        }, '[MCP] 🚀 SMART ROUTING: Tools stripped for simple query');
      } else {
        context.logger.debug({
          query: userQuery.substring(0, 100),
          isSimpleMessage: false,
          toolCount: relevantTools.length,
          reason: 'Complex query detected → tools attached → Gemini/Claude routing'
        }, '[MCP] 🛠️ Tools attached for complex query');
      }

      context.availableTools = relevantTools;

      // CRITICAL FIX: Filter out reasoning/thinking tools that LLMs abuse
      // Models like Gemini use sequentialthinking instead of producing content
      // These tools should NOT be available - models have native thinking capabilities
      const reasoningToolsToBlock = ['sequentialthinking', 'sequential_thinking', 'think', 'reasoning'];
      const originalCount = context.availableTools.length;
      context.availableTools = context.availableTools.filter(tool => {
        const toolName = (tool.function?.name || '').toLowerCase();
        return !reasoningToolsToBlock.some(blocked => toolName.includes(blocked));
      });
      if (context.availableTools.length < originalCount) {
        context.logger.info({
          removed: originalCount - context.availableTools.length,
          reason: 'Blocked reasoning/thinking tools to prevent abuse - LLMs have native thinking'
        }, '[MCP] 🚫 Removed reasoning tools from available tools');
      }

      // =================================================================
      // 📊 DATA LAYER TOOLS: query_data + list_datasets
      // =================================================================
      // Inject data layer tools so LLM can drill into large stored datasets.
      // When tool results >16KB are auto-stored by DataLayerService, the LLM
      // receives "Dataset stored (ID: data_xxx)" and can use query_data to
      // filter/aggregate without re-fetching from MCP servers.
      const dataLayerToolDefs = getDataLayerTools();
      const formattedDataLayerTools = dataLayerToolDefs.map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        serverName: 'data-layer-service'
      }));
      context.availableTools = [...formattedDataLayerTools, ...context.availableTools];

      context.logger.debug({
        totalTools: context.availableTools.length,
        dataLayerTools: formattedDataLayerTools.length
      }, '[MCP] 📊 DATA LAYER: query_data + list_datasets tools injected');

      // TODO: SYSTEM MCP TOOLS - MOVED TO MCP PROXY (oap-diagram-mcp)
      // The create_diagram tool is now handled by the oap-diagram-mcp server in mcp-proxy.
      // Keeping this code commented out for reference in case we need server-side system MCPs later.
      //
      // // 📊 SYSTEM MCP TOOLS: Inject internal tools like create_diagram when needed
      // // These are not in the external MCP registry but provide specialized capabilities
      // const systemMcpTools = getSystemMcpTools(userQuery);
      // if (systemMcpTools.length > 0) {
      //   // Convert system MCP tool definitions to the same format as external tools
      //   const formattedSystemTools = systemMcpTools.map(tool => ({
      //     type: 'function',
      //     function: {
      //       name: tool.name,
      //       description: tool.description,
      //       parameters: tool.input_schema
      //     },
      //     _serverId: 'system-mcp',  // Mark as internal system tool
      //     _isSystemMcp: true
      //   }));
      //
      //   // Add system tools to the beginning (highest priority)
      //   context.availableTools = [...formattedSystemTools, ...context.availableTools];
      //
      //   context.logger.info({
      //     systemToolsAdded: formattedSystemTools.map(t => t.function.name),
      //     isDiagramRequest: isDiagramRequest(userQuery),
      //     totalToolsNow: context.availableTools.length
      //   }, '[MCP] 📊 SYSTEM MCP: Injected internal tools (e.g., create_diagram)');
      // }

      // Inject memory tools (memory_store, memory_recall, memory_forget)
      const memoryTools = getMemoryToolDefinitions();
      context.availableTools = [...memoryTools, ...context.availableTools];

      // =================================================================
      // 🔒 FINAL HARD CEILING: Absolute maximum after ALL injections
      // =================================================================
      // Reserved tools (memory, synth, data-layer) are always-on and get priority.
      // If we exceed MAX_TOTAL_TOOLS, trim semantic tools (lowest similarity first).
      const MAX_TOTAL_TOOLS = 25;
      if (context.availableTools.length > MAX_TOTAL_TOOLS) {
        const beforeFinalTrim = context.availableTools.length;
        // Partition into reserved (memory, synth, data-layer) and semantic tools
        const reservedServerIds = new Set(['data-layer-service', 'system-memory', 'synth-engine']);
        const reservedTools: any[] = [];
        const semanticTools: any[] = [];
        for (const tool of context.availableTools) {
          const serverId = tool._serverId || tool.serverId || tool.function?.server_name || tool.serverName || '';
          const toolName = tool.function?.name || tool.name || '';
          if (reservedServerIds.has(serverId) ||
              toolName.startsWith('memory_') ||
              toolName === 'query_data' || toolName === 'list_datasets' ||
              toolName === 'synthesize_tool') {
            reservedTools.push(tool);
          } else {
            semanticTools.push(tool);
          }
        }
        // Keep all reserved + top semantic tools up to ceiling
        const semanticSlots = Math.max(0, MAX_TOTAL_TOOLS - reservedTools.length);
        context.availableTools = [...reservedTools, ...semanticTools.slice(0, semanticSlots)];
        context.logger.info({
          beforeFinalTrim,
          afterFinalTrim: context.availableTools.length,
          reservedKept: reservedTools.length,
          semanticKept: Math.min(semanticTools.length, semanticSlots),
          semanticDropped: Math.max(0, semanticTools.length - semanticSlots)
        }, '[MCP] 🔒 FINAL HARD CEILING: Enforced absolute maximum tool count');
      }

      context.logger.info({
        finalToolCount: context.availableTools.length,
        toolNames: context.availableTools.slice(0, 10).map(t => t.function?.name),
        processingTime: Date.now() - startTime,
        avgTimePerTool: context.availableTools.length > 0 ? Math.round((Date.now() - startTime) / context.availableTools.length) : 0,
        toolSource: 'INTELLIGENT_ROUTING',
        userFilterApplied: !!(context.request.enabledTools && context.request.enabledTools.length > 0)
      }, '[MCP] 🎉 Tool routing completed - minimized tokens while ensuring relevant tools available');

      return context;

    } catch (error: any) {
      context.logger.error({
        error: error.message,
        stack: error.stack,
        processingTime: Date.now() - startTime,
        errorType: error.constructor.name,
        query: this.extractUserQuery(context)?.substring(0, 100),
        hasMilvus: !!context.milvusService
      }, '[MCP] ❌ Tool search failed with detailed error info');

      // Set empty tools on error to prevent downstream issues
      context.availableTools = [];
      return context;
    }
  }

  private extractUserQuery(context: PipelineContext): string {
    // Get the latest user message
    const userMessages = context.messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) return '';

    const latestMessage = userMessages[userMessages.length - 1];

    // Handle both string and array content
    if (typeof latestMessage.content === 'string') {
      return latestMessage.content;
    } else if (Array.isArray(latestMessage.content)) {
      // Extract text content from array (ignore images, etc.)
      const contentArray = latestMessage.content as Array<{type: string; text?: string}>;
      return contentArray
        .filter((item: any) => item.type === 'text')
        .map((item: any) => item.text)
        .join(' ');
    }

    return '';
  }

  /**
   * Fallback to Redis cache if semantic search is unavailable
   * Returns ALL tools from cache (WARNING: not filtered by intent, sends all tools to LLM)
   */
  private async getStaticToolsFromRedis(context: PipelineContext): Promise<any[]> {
    try {
      context.logger.warn({
        reason: 'semantic_search_unavailable',
        impact: 'ALL_TOOLS_SENT_TO_LLM'
      }, '[MCP] ⚠️ FALLBACK: Using Redis cache (no intent-based filtering)');

      // Get all tools from Redis cache (populated by MCP indexing service)
      const redisClient = context.redisService;
      if (!redisClient) {
        context.logger.error('[MCP] ❌ Redis client not available for fallback');
        return [];
      }

      // Fetch all tools from the cache
      const cacheKey = 'mcp_tools_cache';
      const cachedTools = await redisClient.get(cacheKey);

      if (!cachedTools) {
        context.logger.error('[MCP] ❌ No cached tools found in Redis - MCP indexing may not have run');
        return [];
      }

      // Redis service wrapper already parses JSON, so handle both string and object
      const tools = typeof cachedTools === 'string' ? JSON.parse(cachedTools) : cachedTools;

      // Return all tools from cache (semantic search unavailable)
      context.logger.warn({
        totalToolsInCache: tools.length,
        toolsReturned: tools.length,
        toolNames: tools.slice(0, 10).map((t: any) => t?.function?.name || 'UNNAMED'),
        fallbackMethod: 'REDIS_CACHE_ALL_TOOLS'
      }, '[MCP] ⚠️ FALLBACK: Retrieved ALL tools from Redis (no semantic filtering)');

      return tools;

    } catch (error: any) {
      context.logger.error({
        error: error.message,
        stack: error.stack
      }, '[MCP] ❌ Redis fallback failed - no tools available');
      return [];
    }
  }

  /**
   * 🧠 INTELLIGENT LEARNING: Query ToolSuccessTrackingService and IntentLinkingService
   * Uses structured semantic search in Milvus on past tool usage to suggest relevant tools
   * Also uses cross-collection intent linking for improved tool/prompt routing
   * Reduces token usage by starting with known-good tools
   */
  private async getLearnedToolsForQuery(context: PipelineContext, userQuery: string): Promise<string[]> {
    const allToolNames: string[] = [];

    // 1. Get tools from ToolSuccessTrackingService (direct success patterns)
    try {
      const tracker = getToolSuccessTrackingService();
      const results = await tracker.searchSuccessfulTools({
        query: userQuery,
        userId: context.user.id,
        limit: 5,
        minScore: 0.6,
        includeAllUsers: false  // User-scoped for privacy
      });

      if (results.length > 0) {
        const successTools = results
          .sort((a, b) => b.successScore - a.successScore)
          .map(r => r.toolName);
        allToolNames.push(...successTools);

        context.logger.info({
          userId: context.user.id,
          queryPreview: userQuery.substring(0, 100),
          successTrackingTools: successTools,
          resultsFound: results.length,
          topSuccessScore: results[0]?.successScore,
          topSimilarity: results[0]?.similarity
        }, '[MCP] 🧠 SUCCESS TRACKING: Found previously successful tools');
      }
    } catch (error: any) {
      context.logger.warn({ error: error.message }, '[MCP] 🧠 Tool success tracking search failed');
    }

    // 2. Get tools from IntentLinkingService (cross-collection intent matching)
    try {
      const intentLinker = getIntentLinkingService();
      if (intentLinker.isInitialized) {
        const intentTools = await intentLinker.getToolBoostList(userQuery, context.user.id, 5);

        if (intentTools.length > 0) {
          allToolNames.push(...intentTools);

          // Analyze the query intent for logging
          const intent = intentLinker.analyzeIntent(userQuery);

          context.logger.info({
            userId: context.user.id,
            queryPreview: userQuery.substring(0, 100),
            intentLinkedTools: intentTools,
            detectedIntent: {
              cloudProviders: intent.cloudProviders,
              actions: intent.actions,
              resourceTypes: intent.resourceTypes,
              confidence: intent.confidence
            }
          }, '[MCP] 🔗 INTENT LINKING: Found tools via cross-collection intent matching');
        }
      }
    } catch (error: any) {
      context.logger.warn({ error: error.message }, '[MCP] 🔗 Intent linking search failed');
    }

    // Deduplicate and return
    const uniqueTools = [...new Set(allToolNames)];

    if (uniqueTools.length === 0) {
      context.logger.debug('[MCP] 🧠 No learned tools found from any source');
    } else {
      context.logger.info({
        totalUniqueTools: uniqueTools.length,
        tools: uniqueTools
      }, '[MCP] 🧠 COMBINED LEARNING: Merged tools from success tracking + intent linking');
    }

    return uniqueTools;
  }

  /**
   * 🧠 BOOST LEARNED TOOLS: Move previously successful tools to top of results
   * This prioritizes tools that worked well for similar queries in the past
   */
  private boostLearnedTools(tools: any[], learnedToolNames: string[]): any[] {
    if (learnedToolNames.length === 0) return tools;

    const learnedTools: any[] = [];
    const otherTools: any[] = [];

    for (const tool of tools) {
      const toolName = tool.function?.name;
      if (toolName && learnedToolNames.includes(toolName)) {
        learnedTools.push(tool);
      } else {
        otherTools.push(tool);
      }
    }

    // Learned tools first, then others
    return [...learnedTools, ...otherTools];
  }

  // REMOVED: isBasicQuestion() - We trust semantic search + LLM intelligence.
  // The LLM should decide whether to use tools based on the semantically retrieved tools,
  // not hardcoded keyword lists. Semantic search via Milvus handles relevance.

  // REMOVED: boostCloudProviderTools() - We trust semantic search + LLM intelligence.
  // The Milvus vector search handles tool discovery based on intent, not hardcoded cloud keywords.
  // If cloud provider tools have proper descriptions, they'll be found semantically.

  // REMOVED: tryFastPathRouting() - We use PURE Milvus semantic search.
  // All tool discovery goes through Milvus vector search for proper semantic matching.
  // Do NOT use hardcoded tool names or keyword patterns - let Milvus find tools based on embeddings.

  // REMOVED: getToolByExactName() - No longer needed since all discovery is semantic.

  /**
   * 🔧 ESSENTIAL TOOL HELPER: Search for missing tools using pgvector (primary) or Milvus (fallback).
   * Only searches if there are actually missing tools — avoids unnecessary embedding calls.
   */
  private async searchMissingEssentialTools(
    missingToolNames: string[],
    searchQuery: string,
    context: PipelineContext,
    label: string
  ): Promise<any[]> {
    if (missingToolNames.length === 0) return [];

    // PRIMARY: Use pgvector (faster, already initialized)
    const pgvectorService = getToolPgvectorSearchService();
    if (pgvectorService?.isReady()) {
      try {
        const results = await pgvectorService.searchToolsAsOpenAIFunctions(searchQuery, 15);
        const found: any[] = [];
        for (const name of missingToolNames) {
          const tool = results.find((t: any) => t.function?.name === name);
          if (tool) found.push(tool);
        }
        if (found.length > 0) {
          context.logger.info({ addedTools: found.map(t => t.function?.name), source: 'pgvector' },
            `[MCP] ${label}: Found missing essential tools via pgvector`);
        }
        return found;
      } catch (error: any) {
        context.logger.debug({ error: error.message }, `[MCP] ${label}: pgvector search failed, trying Milvus`);
      }
    }

    // FALLBACK: Use Milvus
    if (global.toolSemanticCache?.isInitialized) {
      try {
        const results = await global.toolSemanticCache.searchToolsAsOpenAIFunctions(searchQuery, 15);
        const found: any[] = [];
        for (const name of missingToolNames) {
          const tool = results.find((t: any) => t.function?.name === name);
          if (tool) found.push(tool);
        }
        if (found.length > 0) {
          context.logger.info({ addedTools: found.map(t => t.function?.name), source: 'milvus' },
            `[MCP] ${label}: Found missing essential tools via Milvus`);
        }
        return found;
      } catch (error: any) {
        context.logger.warn({ error: error.message }, `[MCP] ${label}: Milvus search also failed`);
      }
    }

    // LAST RESORT: Fetch from MCP proxy directly by name
    try {
      const mcpProxyUrl = process.env.MCP_PROXY_URL || 'http://openagentic-mcp-proxy:8080';
      const resp = await fetch(`${mcpProxyUrl}/tools`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        const data = await resp.json() as any;
        const allTools = data.tools || data || [];
        const found: any[] = [];
        for (const name of missingToolNames) {
          const tool = allTools.find((t: any) => {
            const toolName = t.function?.name || t.name || '';
            return toolName === name;
          });
          if (tool) {
            // Normalize to OpenAI function format
            found.push(tool.function ? tool : {
              type: 'function',
              function: { name: tool.name, description: tool.description || '', parameters: tool.inputSchema || tool.parameters || {} }
            });
          }
        }
        if (found.length > 0) {
          context.logger.info({ addedTools: found.map(t => t.function?.name), source: 'mcp-proxy-direct' },
            `[MCP] ${label}: Found missing essential tools via direct MCP proxy fetch`);
        }
        return found;
      }
    } catch (proxyError: any) {
      context.logger.warn({ error: proxyError.message }, `[MCP] ${label}: Direct MCP proxy fetch failed`);
    }

    return [];
  }

  /**
   * 🌐 ESSENTIAL WEB TOOLS: Ensure web_search and web_news_search are available
   * for queries that may need real-time information (weather, news, current events, etc.)
   */
  private async ensureEssentialWebTools(
    tools: any[],
    userQuery: string,
    context: PipelineContext
  ): Promise<any[]> {
    const realTimeKeywords = [
      'weather', 'forecast', 'temperature', 'rain', 'snow', 'humidity',
      'news', 'current', 'today', 'right now', 'latest', 'recent',
      'price', 'stock', 'market', 'bitcoin', 'crypto',
      'score', 'game', 'match', 'playing',
      'search', 'find', 'look up', 'google', 'lookup',
      'what is', 'who is', 'where is', 'when is',
      'happening', 'events', 'schedule',
      'tutorial', 'documentation', 'docs', 'guide', 'how to', 'example',
      'readme', 'reference', 'manual', 'instructions'
    ];

    const queryLower = userQuery.toLowerCase();
    const hasUrl = /https?:\/\/[^\s]+/i.test(userQuery);
    if (!hasUrl && !realTimeKeywords.some(keyword => queryLower.includes(keyword))) {
      return tools;
    }

    const toolNames = tools.map(t => t.function?.name || '');
    const needed: string[] = [];
    if (!toolNames.includes('web_search')) needed.push('web_search');
    if (hasUrl && !toolNames.includes('web_fetch')) needed.push('web_fetch');
    if (!toolNames.includes('web_news_search')) needed.push('web_news_search');

    if (needed.length === 0) return tools;

    const found = await this.searchMissingEssentialTools(
      needed,
      'search the web for information news weather current events browse internet fetch url',
      context, '🌐 WEB'
    );
    return found.length > 0 ? [...found, ...tools] : tools;
  }

  /**
   * 🔐 ESSENTIAL AZURE AD/ENTRA ID TOOLS
   */
  private async ensureEssentialAzureADTools(
    tools: any[], userQuery: string, context: PipelineContext
  ): Promise<any[]> {
    const azureADKeywords = [
      'azure ad', 'azuread', 'active directory', 'entra', 'entra id',
      'azure users', 'ad users', 'azure user', 'ad user',
      'azure groups', 'ad groups', 'azure group', 'ad group',
      'service principal', 'service principals', 'app registration', 'app registrations',
      'enterprise app', 'enterprise apps', 'enterprise application',
      'managed identity', 'managed identities',
      'graph api', 'microsoft graph',
      'who am i', 'whoami', 'my profile', 'my identity', 'my account',
      'list users', 'show users', 'get users', 'find user', 'user list',
      'list groups', 'show groups', 'get groups', 'group members', 'group membership',
      'list apps', 'show apps', 'applications', 'registered apps',
      'directory', 'tenant', 'organization', 'domains'
    ];
    const queryLower = userQuery.toLowerCase();
    if (!azureADKeywords.some(keyword => queryLower.includes(keyword))) return tools;

    const essentialNames = ['azure_list_users', 'azure_get_user', 'azure_list_groups', 'azure_list_apps', 'azure_arm_execute'];
    const toolNames = tools.map(t => t.function?.name || '');
    const missing = essentialNames.filter(t => !toolNames.includes(t));
    if (missing.length === 0) return tools;

    const found = await this.searchMissingEssentialTools(
      missing,
      'Azure Active Directory Entra ID users groups applications service principals ARM execute',
      context, '🔐 AZURE AD'
    );
    return found.length > 0 ? [...found, ...tools] : tools;
  }

  /**
   * ☸️ ESSENTIAL K8s TOOLS
   */
  private async ensureEssentialK8sTools(
    tools: any[], userQuery: string, context: PipelineContext
  ): Promise<any[]> {
    const k8sKeywords = [
      'kubernetes', 'k8s', 'kubectl', 'pods', 'pod', 'deployment', 'deployments',
      'namespace', 'namespaces', 'service', 'services', 'node', 'nodes', 'cluster',
      'helm', 'ingress', 'configmap', 'secret', 'daemonset', 'statefulset',
      'replica', 'hpa', 'pvc', 'pv', 'container', 'kube'
    ];
    const queryLower = userQuery.toLowerCase();
    if (!k8sKeywords.some(kw => queryLower.includes(kw))) return tools;

    const essentialNames = ['k8s_cluster_health', 'k8s_list_pods', 'k8s_list_namespaces', 'k8s_list_deployments', 'k8s_get_pod_logs'];
    const toolNames = tools.map(t => t.function?.name || '');
    const missing = essentialNames.filter(t => !toolNames.includes(t));
    if (missing.length === 0) return tools;

    const found = await this.searchMissingEssentialTools(
      missing,
      'Kubernetes cluster pods deployments namespaces health logs',
      context, '☸️ K8S'
    );
    return found.length > 0 ? [...found, ...tools] : tools;
  }

  /**
   * ☁️ ESSENTIAL AWS TOOLS
   */
  private async ensureEssentialAWSTools(
    tools: any[], userQuery: string, context: PipelineContext
  ): Promise<any[]> {
    const awsKeywords = [
      'aws', 'amazon', 'ec2', 'lambda', 's3', 'dynamodb', 'rds', 'ecs', 'eks',
      'cloudwatch', 'iam', 'sqs', 'sns', 'route53', 'cloudfront', 'elasticache',
      'fargate', 'beanstalk', 'sagemaker', 'bedrock'
    ];
    const queryLower = userQuery.toLowerCase();
    if (!awsKeywords.some(kw => queryLower.includes(kw))) return tools;

    const essentialNames = ['aws_execute', 'call_aws', 'aws_s3_list', 'aws_ec2_list'];
    const toolNames = tools.map(t => t.function?.name || '');
    const missing = essentialNames.filter(t => !toolNames.includes(t));
    if (missing.length === 0) return tools;

    const found = await this.searchMissingEssentialTools(
      missing,
      'AWS Amazon EC2 S3 Lambda CLI execute cloud',
      context, '☁️ AWS'
    );
    return found.length > 0 ? [...found, ...tools] : tools;
  }

  /**
   * 🌐 ESSENTIAL GCP TOOLS
   */
  private async ensureEssentialGCPTools(
    tools: any[], userQuery: string, context: PipelineContext
  ): Promise<any[]> {
    const gcpKeywords = [
      'gcp', 'google cloud', 'gke', 'compute engine', 'cloud storage', 'bigquery',
      'cloud run', 'cloud functions', 'pubsub', 'firestore', 'vertex ai',
      'gce', 'gcr', 'artifact registry'
    ];
    const queryLower = userQuery.toLowerCase();
    if (!gcpKeywords.some(kw => queryLower.includes(kw))) return tools;

    const essentialNames = ['gcp_compute_list', 'gcp_storage_list', 'gcp_billing_query'];
    const toolNames = tools.map(t => t.function?.name || '');
    const missing = essentialNames.filter(t => !toolNames.includes(t));
    if (missing.length === 0) return tools;

    const found = await this.searchMissingEssentialTools(
      missing,
      'GCP Google Cloud compute storage billing',
      context, '🌐 GCP'
    );
    return found.length > 0 ? [...found, ...tools] : tools;
  }

  /**
   * 🐙 ESSENTIAL GITHUB TOOLS
   */
  private async ensureEssentialGitHubTools(
    tools: any[], userQuery: string, context: PipelineContext
  ): Promise<any[]> {
    const githubKeywords = [
      'github', 'git', 'repository', 'repo', 'pull request', 'pr', 'issue',
      'commit', 'branch', 'merge', 'clone', 'fork', 'release', 'actions',
      'workflow', 'ci/cd', 'pipeline'
    ];
    const queryLower = userQuery.toLowerCase();
    if (!githubKeywords.some(kw => queryLower.includes(kw))) return tools;

    const essentialNames = ['github_list_repos', 'github_create_pr', 'github_list_issues', 'github_search_code'];
    const toolNames = tools.map(t => t.function?.name || '');
    const missing = essentialNames.filter(t => !toolNames.includes(t));
    if (missing.length === 0) return tools;

    const found = await this.searchMissingEssentialTools(
      missing,
      'GitHub repository pull request issues code search',
      context, '🐙 GITHUB'
    );
    return found.length > 0 ? [...found, ...tools] : tools;
  }

  /**
   * 📊 ESSENTIAL OBSERVABILITY TOOLS (Loki, Prometheus, AlertManager)
   */
  private async ensureEssentialObservabilityTools(
    tools: any[], userQuery: string, context: PipelineContext
  ): Promise<any[]> {
    const obsKeywords = [
      'loki', 'log', 'logs', 'logql', 'prometheus', 'promql', 'metrics', 'metric',
      'alert', 'alerts', 'alertmanager', 'monitoring', 'grafana', 'dashboard',
      'error rate', 'latency', 'uptime', 'sre', 'observability'
    ];
    const queryLower = userQuery.toLowerCase();
    if (!obsKeywords.some(kw => queryLower.includes(kw))) return tools;

    const essentialNames = [
      'loki_query', 'loki_search_errors', 'loki_labels', 'loki_label_values',
      'loki_tail', 'loki_count_logs', 'loki_streams',
      'prometheus_query', 'prometheus_query_range', 'prometheus_alerts',
      'prometheus_targets', 'prometheus_health_summary'
    ];
    const toolNames = tools.map(t => t.function?.name || t.name || '');
    const missing = essentialNames.filter(t => !toolNames.includes(t));

    context.logger.info({
      matchedKeyword: obsKeywords.find(kw => queryLower.includes(kw)),
      existingToolCount: tools.length,
      existingToolNames: toolNames.slice(0, 10),
      missingCount: missing.length,
      missingTools: missing.slice(0, 10)
    }, '[MCP] 📊 OBSERVABILITY safety net triggered');

    if (missing.length === 0) return tools;

    const found = await this.searchMissingEssentialTools(
      missing,
      'Loki logs query Prometheus metrics alerts monitoring observability',
      context, '📊 OBSERVABILITY'
    );
    context.logger.info({
      foundCount: found.length,
      foundNames: found.map(t => t.function?.name || t.name)
    }, '[MCP] 📊 OBSERVABILITY safety net result');
    return found.length > 0 ? [...found, ...tools] : tools;
  }

  /**
   * 🚀 SMART TOOL ATTACHMENT: Detect queries that DON'T need MCP tools
   *
   * This is the key optimization for Ollama routing:
   * - Simple queries → NO tools → Ollama (FREE, fast)
   * - Complex queries → Tools attached → Gemini/Claude (better tool handling)
   *
   * CRITICAL: This directly impacts model routing in TaskAnalysisService!
   * If tools are attached, the routing condition (!hasTools || ollamaSupportsTools) fails
   * and queries get routed to paid models even when Ollama could handle them.
   */
  private isSimpleConversationalMessage(query: string): boolean {
    const normalizedQuery = query.toLowerCase().trim();

    // ========================================================
    // TOOL-REQUIRING QUERIES - Always attach tools for these
    // ========================================================

    // Cloud provider keywords - ALWAYS need MCP tools
    const cloudKeywords = [
      'aws', 'azure', 'gcp', 'cloud', 'ec2', 'lambda', 's3', 'dynamodb', 'rds',
      'subscription', 'resource group', 'vm', 'virtual machine', 'bucket', 'storage',
      'account', 'region', 'iam', 'kubernetes', 'k8s', 'eks', 'aks', 'gke', 'cost',
      'workflow', 'chatflow', 'diagram', 'infrastructure', 'deploy',
      // Azure AD / Entra ID
      'azure ad', 'active directory', 'entra', 'ad user', 'azure user',
      'ad group', 'service principal', 'app registration', 'graph api', 'tenant'
    ];
    if (cloudKeywords.some(kw => normalizedQuery.includes(kw))) {
      return false;  // Cloud queries ALWAYS need tools
    }

    // Web/search keywords - need fetch/search tools
    const webKeywords = [
      'web search', 'browse', 'search for', 'look up online', 'google',
      'fetch', 'website', 'url', 'news', 'weather', 'current events'
    ];
    if (webKeywords.some(kw => normalizedQuery.includes(kw))) {
      return false;  // Web queries need tools
    }

    // Memory/context keywords - need memory tools
    const memoryKeywords = [
      'remember', 'recall', 'yesterday', 'last time', 'previous', 'earlier',
      'before', 'history', 'conversation', 'what did i', 'what we discussed'
    ];
    if (memoryKeywords.some(kw => normalizedQuery.includes(kw))) {
      return false;  // Memory queries need tools
    }

    // Admin/system keywords - need admin tools
    const adminKeywords = [
      'health', 'status', 'system', 'redis', 'postgres', 'milvus', 'database',
      'server', 'config', 'setting', 'admin', 'metrics', 'logs'
    ];
    if (adminKeywords.some(kw => normalizedQuery.includes(kw))) {
      return false;  // Admin queries need tools
    }

    // Code execution keywords - need code runner tools
    const codeKeywords = [
      'run code', 'execute', 'python', 'javascript', 'compile', 'script'
    ];
    if (codeKeywords.some(kw => normalizedQuery.includes(kw))) {
      return false;  // Code queries need tools
    }

    // ========================================================
    // SIMPLE QUERIES - Strip tools, route to Ollama
    // ========================================================

    // Common greetings - definitely simple
    const greetings = [
      'hello', 'hi', 'hey', 'howdy', 'good morning', 'good afternoon', 'good evening',
      'what\'s up', 'wassup', 'yo', 'greetings', 'how are you', 'how\'s it going',
      'thanks', 'thank you', 'bye', 'goodbye', 'see you', 'cheers'
    ];
    if (greetings.some(g => normalizedQuery.includes(g) || normalizedQuery === g)) {
      return true;  // Simple greeting → Ollama
    }

    // Math questions (with flexible spacing) - LLM can calculate
    const mathPatterns = [
      /^what('s| is)\s+\d+\s*[\+\-\*\/x×÷]\s*\d+/i,  // "what is 15 + 27" with any spacing
      /^\d+\s*[\+\-\*\/x×÷]\s*\d+\s*[=?]?$/,         // "15 + 27" or "15 + 27 ="
      /^calculate\s+\d+/i,                           // "calculate 15 + 27"
      /^(add|subtract|multiply|divide)\s+\d+/i,     // "add 15 and 27"
      /^how much is\s+\d+/i,                         // "how much is 15 + 27"
      /^what does\s+\d+\s*[\+\-\*\/]/i              // "what does 15 + 27 equal"
    ];
    if (mathPatterns.some(p => p.test(normalizedQuery))) {
      return true;  // Math question → Ollama
    }

    // Simple knowledge questions - LLM's training data covers these
    const knowledgePatterns = [
      /^what is the capital of/i,
      /^who (is|was|are|were) /i,
      /^when (is|was|did) /i,
      /^where (is|was|are) /i,
      /^explain (what|how|why|the)/i,
      /^define /i,
      /^what does .* mean/i,
      /^how (do|does|can|should) (i|you|we|one)/i,
      /^tell me (about|a joke|something)/i,
      /^describe /i,
      /^list (the|some|a few)/i
    ];
    if (knowledgePatterns.some(p => p.test(normalizedQuery))) {
      return true;  // Knowledge question → Ollama
    }

    // Simple requests
    const simpleRequestPatterns = [
      /^(just )?say /i,                     // "Just say Hello!"
      /^repeat /i,                          // "Repeat after me"
      /^translate .* to /i,                 // Translation (LLM can do)
      /^write (a |an )?(short |brief )?(poem|haiku|limerick|joke)/i,
      /^(help me )?(summarize|paraphrase)/i
    ];
    if (simpleRequestPatterns.some(p => p.test(normalizedQuery))) {
      return true;  // Simple request → Ollama
    }

    // Short messages (< 50 chars) without tool indicators are likely simple
    if (normalizedQuery.length < 50) {
      // Check if it's a question that LLMs can answer from training
      const isQuestion = /^(what|who|when|where|why|how|is|are|was|were|do|does|did|can|could|will|would|should)/i.test(normalizedQuery);
      if (isQuestion) {
        return true;  // Short question → Ollama
      }
    }

    // Very short messages (< 20 chars) are almost always simple
    if (normalizedQuery.length < 20) {
      return true;  // Very short → Ollama
    }

    return false;  // Default: attach tools (complex query)
  }

  /**
   * Determine if a query warrants parallel agent execution.
   * Only returns true for queries that contain multiple clearly independent sub-tasks.
   * Most queries should NOT trigger parallel agents.
   */
  private queryWarrantsParallelAgents(query: string): boolean {
    const normalizedQuery = query.toLowerCase().trim();

    // Very short queries never need parallel agents
    if (normalizedQuery.length < 50) return false;

    // Always inject for complex queries — let the LLM decide when to use it
    // The tool description and system prompt provide guidance on appropriate usage
    const complexityIndicators = [
      /\band\b/i,                        // any conjunction suggests multiple tasks
      /\bcompare\b/i,                    // comparison tasks
      /\bsimultaneously\b/i,            // explicit parallel request
      /\bin parallel\b/i,               // explicit parallel request
      /\bconcurrently\b/i,              // explicit parallel request
      /\bboth\b/i,                       // "check both X and Y"
      /\b(\d+)\s+\w+/i,                 // numbered items
      /\bfirst\b.*\bthen\b/i,           // sequential steps
      /\banalyze\b/i,                   // analysis tasks are often complex
      /\breport\b/i,                    // reports often need multiple data sources
      /\bdashboard\b/i,                 // dashboards need parallel data gathering
      /\baudit\b/i,                     // audits span multiple systems
      /\bmonitor\b/i,                   // monitoring is inherently multi-source
      /\bcreate\b.*\bwith\b/i,          // creation tasks with requirements
      /\bmultiple\b/i,                  // explicit mention of multiple things
      /\ball\b.*\b(resources|services|systems)\b/i, // broad scope queries
    ];

    return complexityIndicators.some(p => p.test(normalizedQuery));
  }

  async rollback(context: PipelineContext): Promise<void> {
    // Clear any MCP-related context
    context.availableTools = [];
    context.logger.info('[MCP] Stage rollback completed');
  }
}