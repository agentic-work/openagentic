/**
 * useAIFlowChat - Isolated workflow generation hook
 * Uses /api/v1/chat/completions (OpenAI-compatible) for direct LLM calls
 * Does NOT create chat sessions - flows are completely isolated from chat
 * Parses ```workflow JSON blocks from AI responses
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAuth } from '@/app/providers/AuthContext';
import { useMCP } from '@/app/providers/MCPContext';
import type { WorkflowDefinition } from '../types/workflow.types';
import { buildSystemPromptWithFragment } from './schemaPromptBuilder';
import { useNodeSchemas } from './useNodeSchemas';

const BASE_SYSTEM_PROMPT = `You are an expert AI workflow architect for OpenAgentic, a multi-agent orchestration platform.
You help users CREATE, TROUBLESHOOT, RUN, and MANAGE their workspace workflows.

## Your Capabilities
1. **Create workflows** — Generate workflow definitions from natural language descriptions
2. **Troubleshoot workflows** — Analyze existing workflows and fix issues
3. **Suggest improvements** — Recommend MCP tools, agent configurations, and optimizations
4. **Explain workflows** — Break down what each node does and how data flows

## Workflow JSON Schema
When generating a workflow, output JSON matching this schema wrapped in a \`\`\`workflow code block:
{ "nodes": [{ "id": string, "type": string, "position": {"x": number, "y": number}, "data": {"label": string, ...config} }], "edges": [{ "id": string, "source": string, "target": string }] }

## Available Node Types

### Triggers
- **trigger** — Manual or scheduled trigger. data: { triggerType: "manual"|"schedule"|"webhook", schedule: "*/5 * * * *" }

### AI / LLM
- **openagentic_llm** — Unified LLM node (uses platform model routing). data: { prompt, systemPrompt, sliderOverride, modelOverride, temperature, maxTokens, enableThinking, thinkingBudget }
- **multi_agent** — Spawn concurrent agents with shared context. data: { maxConcurrency, agents: [{role, task, tools}], aggregationStrategy: "merge"|"synthesize"|"first"|"vote", sharedContext, timeoutMs }
- **agent_single** — Run a single agent from the registry. data: { agentId, task, modelOverride, toolWhitelist, maxTurns, costBudget }
- **agent_pool** — Fan-out to N agents, fan-in results. data: { agents: [{agentId, task}], concurrency, aggregation }
- **agent_supervisor** — One LLM supervises and delegates to workers. data: { supervisorModel, supervisorPrompt, workerAgents }

### Actions
- **mcp_tool** — Call any MCP tool. data: { toolName: string, args: object }
- **code** — Execute code inline. data: { code, language: "javascript"|"python" }
- **openagentic** — Run code in sandboxed Claude Code session. data: { prompt, workspace }
- **http_request** — Make HTTP calls. data: { url, method, headers, body }

### Logic
- **condition** — Branch based on expression. data: { condition: "JS expression", trueLabel, falseLabel }
- **loop** — Repeat until condition. data: { maxIterations, breakCondition }
- **wait** — Pause execution. data: { durationMs, waitForEvent }

### Data
- **transform** — Transform data with JavaScript. data: { transform: "JS expression" }
- **merge** — Merge multiple inputs. data: { strategy: "concat"|"merge"|"zip" }
- **rag_query** — Query Milvus vector DB collection. data: { collectionName, queryText, topK: 10, filters: {}, embeddingModel }
- **file_upload** — Ingest files into knowledge base. data: { collectionName, fileSource: "input_data"|"url"|"file_path", chunkSize: 512, chunkOverlap: 50 }
- **data_query** — Query structured data sources. data: { collection, query, prompt }
- **user_context** — Load cross-mode user context. data: { contextScope: "recent"|"session"|"full", maxItems: 10 }
- **document_loader** — Load content from URLs, CSV, JSON, PDF. data: { sourceType: "url"|"csv"|"json", url, parseMode: "auto"|"text" }
- **text_splitter** — Split documents into chunks. data: { strategy: "recursive"|"token"|"semantic", chunkSize: 512, chunkOverlap: 50 }
- **embedding** — Generate vector embeddings. data: { model: "text-embedding-3-small", dimensions: 1536, batchSize: 100 }
- **vector_store** — Write/upsert vectors to Milvus. data: { collection, operation: "upsert"|"delete", createIfMissing: true }
- **structured_output** — Enforce JSON schema on LLM output. data: { model, schema: "{...}", retryOnFail: true, maxRetries: 2 }
- **guardrails** — Validate content against safety rules. data: { checks: ["pii","toxicity","injection"], action: "block"|"redact" }

### Logic (continued)
- **switch** — Multi-way branching (N output paths). data: { expression: "$input.status", cases: [{value: "ok", label: "Success"}, {value: "error", label: "Error"}] }
- **parallel** — Explicit fan-out/fan-in. data: { mode: "split"|"join", waitForAll: true, timeoutMs }
- **error_handler** — Catch and handle errors. data: { errorAction: "log"|"retry"|"notify"|"transform", maxRetries, retryDelay }

### AI (continued)
- **reasoning** — Extended thinking / chain-of-thought. data: { prompt, thinkingBudget: 16384, model, outputFormat: "text"|"json"|"markdown" }

### Approval
- **approval** — Human-in-the-loop approval gate. data: { approvers, message, timeoutMs }

### Synthesis
- **synth** — OAT tool synthesis. data: { intent, capabilities: ["http","file","code"], dryRun }

### Integration
- **slack_message** — Send Slack message. data: { channel, message, botName }
- **teams_message** — Send Teams message via webhook. data: { webhookUrl, message, title }
- **send_email** / **outlook_email** — Send email. data: { to, subject, body, cc, bodyFormat }
- **pagerduty_incident** — Create PagerDuty incident. data: { serviceId, title, severity, details }
- **servicenow_ticket** — Create ServiceNow record. data: { table, shortDescription, description, priority }
- **jira_issue** — Create Jira issue. data: { projectKey, issueType, summary, description }
- **discord_message** — Send Discord message. data: { webhookUrl, message, username }
- **webhook_response** — Return data to webhook caller. data: { statusCode: 200, headers: {}, bodyTemplate }

## Layout Rules
- Position nodes left-to-right, 250px horizontal spacing, 150px vertical for branches
- Always start with a trigger node
- Use conditions for branching logic
- Connect nodes with edges: { id: "e_src_dst", source: "src_id", target: "dst_id" }

## Special Use Cases

### Mobile App Development (Vibecode)
When a user wants to build a mobile app (iOS/Android) with live preview:
1. Use an **openagentic** node as the primary builder — it runs Claude Code in a sandboxed session
2. The prompt should instruct Claude Code to:
   - Initialize an Expo/React Native project in the workspace
   - Generate the requested app with all screens/components
   - Run \`npx expo start --tunnel\` for instant device preview via QR code
3. Use a **condition** node to check build output for errors
4. Chain an **openagentic_llm** node to analyze/fix any build errors automatically
5. Include an **approval** node for the user to confirm they like the preview before continuing
6. This creates a feedback loop: user describes → AI builds → live preview → user refines → AI iterates

Example flow: trigger → openagentic (scaffold + generate app) → condition (build success?) → [true] approval (user reviews preview) → openagentic (apply user feedback) → [false] openagentic_llm (analyze error) → openagentic (fix and retry)

The openagentic node workspace persists between iterations, so the AI can incrementally improve the app.

## IMPORTANT
- Use "openagentic_llm" for ALL LLM calls (not raw provider calls)
- Use "mcp_tool" nodes for real tool integrations (web search, database queries, cloud operations)
- Use "multi_agent" or "agent_pool" for parallel work
- Use "rag_query" for vector search against Milvus collections, "file_upload" for ingestion
- Use "switch" for multi-way branching instead of chained conditions
- Use "parallel" for explicit fan-out/fan-in of parallel branches
- Use "error_handler" nodes to catch and handle failures gracefully
- Use integration nodes (slack, teams, email, pagerduty, jira, etc.) for notifications
- Wrap workflow JSON in a \`\`\`workflow code block
- Provide a brief natural language description before the JSON

## Troubleshooting & Self-Healing

When fixing execution errors, apply these patterns:

### MCP Tool Errors
- **"validation error"** → The tool's argument schema doesn't match. MCP tools use POSITIONAL arguments passed via \`arguments\` object, NOT a \`message\` field. Check the tool's schema and fix the \`arguments\` in the mcp_tool node data.
- **"tool not found"** → The tool server name may have changed. Common mappings: \`openagentic_azure\` (Azure tools), \`openagentic_aws\` (AWS tools), \`openagentic_admin\` (admin tools), \`openagentic_web\` (web search/scraping). Check available MCP tools list.
- **"ECONNREFUSED"** → The MCP server is down. Replace the mcp_tool node with an equivalent openagentic_llm node that simulates the operation, or add an error_handler node upstream.

### LLM Completion Errors
- **"NO_CAPABLE_MODELS"** → No model is available for the request type. Remove \`modelOverride\` from the node or set it to a known-available model. The platform smart router handles model selection automatically.
- **"AUTHENTICATION_ERROR"** → A provider's credentials are invalid. Remove \`modelOverride\` to let the router pick a working provider, or set \`sliderOverride\` to 0 (cheapest/local models).

### Condition Node Errors
- Condition expressions must be valid JavaScript that returns truthy/falsy
- Use \`input.field\` to reference incoming data (NOT \`{{steps.nodeId.output}}\`)
- Template syntax \`{{steps.nodeId.output}}\` is for prompt interpolation in LLM nodes, NOT for condition/transform expressions
- In condition/transform nodes, previous node output is available as \`input\`

### Transform Node Errors
- Transform expressions are JavaScript arrow functions or expressions
- Input data is available as \`input\` variable
- Return an object: \`({ summary: input.content, timestamp: new Date().toISOString() })\`

### Common Fixes
1. **Node gets "No input data"** → Check edges. The node may be unreachable (disconnected from the graph or behind a condition that always evaluates false)
2. **Workflow "valid: false"** → The compiler found structural errors. Ensure: trigger exists, all nodes are connected, no orphan nodes, no circular dependencies
3. **Timeout** → LLM nodes with very long prompts or high maxTokens. Reduce maxTokens or split into smaller steps
4. **Agent proxy unavailable** → multi_agent/agent_spawn nodes need the openagentic-proxy service. If unavailable, the engine falls back to direct LLM. This is usually fine.

When outputting fixes, ALWAYS use a \`\`\`patch block for targeted fixes (preferred) or a \`\`\`workflow block for major restructuring. After describing the fix, ask the user to re-execute to verify.`;

export interface CanvasContext {
  flowName?: string;
  flowDescription?: string;
  nodes: Array<{ id: string; type: string; label: string; config?: Record<string, any> }>;
  edges: Array<{ source: string; target: string }>;
}

export interface ExecutionContext {
  status: string;
  executionTimeMs?: number;
  nodeResults: Record<string, { status: string; error?: string; durationMs?: number }>;
}

export interface WorkflowPatch {
  nodeId: string;
  updates: Record<string, any>;
}

function buildSystemPrompt(
  mcpTools: string[],
  existingWorkflows: string[],
  canvasState?: CanvasContext | null,
  lastExecution?: ExecutionContext | null,
  rawDefinition?: { nodes: any[]; edges: any[] } | null,
  aiPromptFragment?: string,
): string {
  // Use schema-driven fragment if available, fall back to legacy BASE_SYSTEM_PROMPT
  let prompt: string;
  if (aiPromptFragment && aiPromptFragment.trim()) {
    prompt = buildSystemPromptWithFragment(aiPromptFragment, mcpTools, existingWorkflows);
  } else {
    prompt = BASE_SYSTEM_PROMPT;
    if (mcpTools.length > 0) {
      prompt += `\n\n## Available MCP Tools (${mcpTools.length} total)\nUse these tool names in mcp_tool nodes:\n${mcpTools.slice(0, 100).join(', ')}`;
      if (mcpTools.length > 100) prompt += `\n...and ${mcpTools.length - 100} more`;
    }
    if (existingWorkflows.length > 0) {
      prompt += `\n\n## User's Existing Workflows\n${existingWorkflows.join('\n')}`;
    }
  }

  if (canvasState && canvasState.nodes.length > 0) {
    const flowHeader = canvasState.flowName
      ? `\n\n## Current Flow: "${canvasState.flowName}"${canvasState.flowDescription ? `\nDescription: ${canvasState.flowDescription}` : ''}`
      : '';
    const nodesSummary = canvasState.nodes.map(n => {
      // Full config — no truncation so the AI sees complete prompts, code, etc.
      const cfg = n.config ? ` — ${JSON.stringify(n.config)}` : '';
      return `  - ${n.id} (${n.type}): "${n.label}"${cfg}`;
    }).join('\n');
    const edgesSummary = canvasState.edges.map(e => `  ${e.source} → ${e.target}`).join('\n');
    prompt += `${flowHeader}\n\n## Canvas State (${canvasState.nodes.length} nodes, ${canvasState.edges.length} edges)\nNodes:\n${nodesSummary}\nEdges:\n${edgesSummary}`;

    // Include full raw workflow definition JSON for accurate modifications
    if (rawDefinition) {
      prompt += `\n\n## Full Workflow Definition (use this as base when outputting modifications)\n\`\`\`json\n${JSON.stringify(rawDefinition, null, 2)}\n\`\`\``;
    }

    prompt += `\n\nWhen the user asks to modify the current workflow, you can output a \`\`\`patch block instead of a full \`\`\`workflow block.
Patch format (JSON array): [{ "nodeId": "node_id", "updates": { "data.field": "new_value" } }]
Use patches for small changes (updating a prompt, renaming, reconfiguring). Use full \`\`\`workflow blocks for major restructuring.`;
  }

  if (lastExecution) {
    const nodeLines = Object.entries(lastExecution.nodeResults).map(([id, r]) => {
      // Include full error text (up to 500 chars) so AI can diagnose precisely
      const err = r.error ? ` — ERROR: ${r.error.slice(0, 500)}` : '';
      const dur = r.durationMs ? ` (${r.durationMs}ms)` : '';
      return `  - ${id}: ${r.status}${dur}${err}`;
    }).join('\n');
    const failedCount = Object.values(lastExecution.nodeResults).filter(r => r.status === 'failed' || r.error).length;
    const passedCount = Object.values(lastExecution.nodeResults).filter(r => r.status === 'completed').length;
    prompt += `\n\n## Last Execution Result: ${lastExecution.status} (${passedCount} passed, ${failedCount} failed)${lastExecution.executionTimeMs ? ` — ${lastExecution.executionTimeMs}ms total` : ''}\n${nodeLines}`;
    if (failedCount > 0) {
      prompt += `\n\nACTION REQUIRED: Fix all ${failedCount} failed nodes. Output a \`\`\`patch block with fixes for each failed node. Refer to the Troubleshooting section for common fix patterns.`;
    }
  }

  return prompt;
}

export interface AIFlowMessage {
  role: 'user' | 'assistant';
  content: string;
  workflowDefinition?: WorkflowDefinition;
  patches?: WorkflowPatch[];
}

function extractWorkflowDefinition(text: string): WorkflowDefinition | undefined {
  // Try ```workflow first, then ```json, then any ``` block containing workflow JSON
  const patterns = [
    /```workflow\s*\n([\s\S]*?)```/,
    /```json\s*\n([\s\S]*?)```/,
    /```\s*\n([\s\S]*?)```/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;

    const block = match[1].trim();
    // Try direct parse
    try {
      const parsed = JSON.parse(block);
      if (parsed.nodes && Array.isArray(parsed.nodes) && parsed.edges && Array.isArray(parsed.edges)) {
        return parsed as WorkflowDefinition;
      }
    } catch { /* try extracting JSON object */ }

    // Try to find JSON object within the block
    const jsonMatch = block.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.nodes && parsed.edges) return parsed as WorkflowDefinition;
      } catch { /* continue to next pattern */ }
    }
  }

  // Last resort: find any JSON with nodes/edges in the text
  const jsonMatch = text.match(/\{[^{}]*"nodes"\s*:\s*\[[\s\S]*?"edges"\s*:\s*\[[\s\S]*?\}\s*\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0] + '}');
      if (parsed.nodes && parsed.edges) return parsed as WorkflowDefinition;
    } catch { /* ignore */ }
  }

  return undefined;
}

function extractPatchDefinition(text: string): WorkflowPatch[] | undefined {
  const patchPattern = /```patch\s*\n([\s\S]*?)```/;
  const match = text.match(patchPattern);
  if (!match) return undefined;

  try {
    const parsed = JSON.parse(match[1].trim());
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].nodeId) {
      return parsed as WorkflowPatch[];
    }
  } catch { /* not valid patch JSON */ }
  return undefined;
}

export function useAIFlowChat() {
  const [messages, setMessages] = useState<AIFlowMessage[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const { getAuthHeaders } = useAuth();
  const { mcps } = useMCP();
  // Schema-driven AI prompt fragment — replaces the hand-maintained node list
  const { aiPromptFragment } = useNodeSchemas();
  const abortRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  // Keep conversation history in OpenAI format for multi-turn context
  const conversationRef = useRef<Array<{ role: string; content: string }>>([]);
  const mcpToolNamesRef = useRef<string[]>([]);
  const existingWorkflowsRef = useRef<string[]>([]);
  const canvasContextRef = useRef<CanvasContext | null>(null);
  const executionContextRef = useRef<ExecutionContext | null>(null);
  const rawDefinitionRef = useRef<{ nodes: any[]; edges: any[] } | null>(null);
  const availableModelsRef = useRef<string[]>([]);
  const providerHealthRef = useRef<string>('');

  // Build MCP tool names list from context
  useEffect(() => {
    if (mcps && mcps.length > 0) {
      const names: string[] = [];
      for (const server of mcps) {
        if (server.tools) {
          for (const tool of server.tools) {
            names.push(tool.name);
          }
        }
      }
      mcpToolNamesRef.current = names;
    }
  }, [mcps]);

  // Fetch available models and provider health for AI context
  useEffect(() => {
    const headers = getAuthHeaders();
    // Models
    fetch('/api/v1/models', { headers }).then(r => r.json()).then(data => {
      const models = (data.data || []).map((m: any) => `${m.id} (${m.owned_by || 'unknown'})`);
      availableModelsRef.current = models;
    }).catch(() => {});
    // Providers
    fetch('/api/admin/llm-providers/database', { headers }).then(r => r.json()).then(data => {
      const providers = (data.providers || []).map((p: any) =>
        `${p.name} (${p.provider_type}) — ${p.enabled ? 'enabled' : 'disabled'}, priority ${p.priority}`
      );
      providerHealthRef.current = providers.join('\n');
    }).catch(() => {});
  }, []);

  // Fetch existing workflows on mount
  useEffect(() => {
    const fetchWorkflows = async () => {
      try {
        const headers = getAuthHeaders();
        const res = await fetch('/api/workflows', { headers });
        if (res.ok) {
          const data = await res.json();
          const wfs = data.workflows || [];
          existingWorkflowsRef.current = wfs.slice(0, 20).map(
            (w: any) => `- "${w.name}" (${w.status || 'draft'}, ${w.node_count || '?'} nodes)`
          );
        }
      } catch { /* ignore */ }
    };
    fetchWorkflows();
  }, [getAuthHeaders]);

  const sendMessage = useCallback(async (userMessage: string): Promise<WorkflowDefinition | undefined> => {
    // Add user message to UI
    const newUserMsg: AIFlowMessage = { role: 'user', content: userMessage };
    setMessages(prev => [...prev, newUserMsg]);
    setIsGenerating(true);

    let fullContent = '';
    let workflowDef: WorkflowDefinition | undefined;

    try {
      abortRef.current = new AbortController();
      const headers = getAuthHeaders();

      // Build OpenAI-format messages with dynamic system prompt + conversation history
      // Uses schema-driven aiPromptFragment when available, falls back to legacy list
      let systemPrompt = buildSystemPrompt(
        mcpToolNamesRef.current,
        existingWorkflowsRef.current,
        canvasContextRef.current,
        executionContextRef.current,
        rawDefinitionRef.current,
        aiPromptFragment || undefined,
      );
      // Enrich with available models and provider health
      if (availableModelsRef.current.length > 0) {
        systemPrompt += `\n\n## Available LLM Models (${availableModelsRef.current.length})\nUse these in modelOverride fields:\n${availableModelsRef.current.join(', ')}`;
      }
      if (providerHealthRef.current) {
        systemPrompt += `\n\n## LLM Provider Status\n${providerHealthRef.current}`;
      }
      const apiMessages = [
        { role: 'system', content: systemPrompt },
        ...conversationRef.current,
        { role: 'user', content: userMessage },
      ];

      // Flows AI is a workflow builder assistant — it generates JSON, not agentic tool calls.
      // Always use the simple OpenAI-compatible endpoint with smart router ('auto').
      // No need for the full chat pipeline (MCP tools, agent delegation, synth approvals).
      const endpoint = '/api/v1/chat/completions';
      const body = {
        messages: apiMessages,
        stream: true,
        model: 'auto',
        max_tokens: 8192,
        temperature: 0.7,
        // Push toward premium models for AI Builder (large context + JSON generation)
        slider_position: 70,
        metadata: {
          source: 'ai-builder',
          contextSize: systemPrompt.length,
          requiresJSON: true,
        },
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortRef.current.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new Error(`API error ${response.status}: ${errorText}`);
      }

      if (response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let lineBuffer = ''; // Buffer for lines split across chunks

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          lineBuffer += decoder.decode(value, { stream: true });
          const lines = lineBuffer.split('\n');
          // Keep the last (potentially incomplete) line in the buffer
          lineBuffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const dataStr = trimmed.substring(5).trim();
            if (dataStr === '[DONE]') continue;

            try {
              const data = JSON.parse(dataStr);
              // OpenAI SSE format: data.choices[0].delta.content
              const delta = data.choices?.[0]?.delta;
              if (delta?.content != null && delta.content !== '') {
                fullContent += delta.content;
              }
              // Chat pipeline format: data.type === 'content' with data.content
              else if (data.type === 'content' && data.content) {
                fullContent += data.content;
              }
              // Chat pipeline format: data.type === 'chunk' with data.text
              else if (data.type === 'chunk' && data.text) {
                fullContent += data.text;
              }
              // Direct content format as fallback
              else if (data.content && typeof data.content === 'string') {
                fullContent += data.content;
              }
              // Tool use results from agentic mode
              else if (data.type === 'tool_result' && data.result) {
                const toolInfo = `\n\n**Tool: ${data.toolName || 'unknown'}**\n${typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2)}\n`;
                fullContent += toolInfo;
              }
            } catch { /* skip non-JSON lines */ }
          }

          // Update assistant message as it streams
          if (fullContent) {
            setMessages(prev => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;
              if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
                updated[lastIdx] = { ...updated[lastIdx], content: fullContent };
              } else {
                updated.push({ role: 'assistant', content: fullContent });
              }
              return updated;
            });
          }
        }

        // Process any remaining buffered data
        if (lineBuffer.trim()) {
          const trimmed = lineBuffer.trim();
          if (trimmed.startsWith('data:')) {
            const dataStr = trimmed.substring(5).trim();
            if (dataStr !== '[DONE]') {
              try {
                const data = JSON.parse(dataStr);
                const delta = data.choices?.[0]?.delta;
                if (delta?.content != null && delta.content !== '') {
                  fullContent += delta.content;
                } else if (data.content) {
                  fullContent += data.content;
                }
              } catch { /* skip */ }
            }
          }
        }
      }

      if (!fullContent || fullContent.trim().length < 10) {
        console.warn('[AI Builder] Empty response from model');
        setMessages(prev => {
          const updated = [...prev];
          if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
            updated[updated.length - 1] = {
              ...updated[updated.length - 1],
              content: 'I had trouble processing that request. Please try again.',
            };
          }
          return updated;
        });
      }

      // Extract workflow definition or patches from final content
      workflowDef = extractWorkflowDefinition(fullContent);
      const patches = extractPatchDefinition(fullContent);

      // Update conversation history for multi-turn context
      conversationRef.current.push(
        { role: 'user', content: userMessage },
        { role: 'assistant', content: fullContent },
      );

      // Final update with workflow definition and/or patches
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
          updated[lastIdx] = { ...updated[lastIdx], content: fullContent, workflowDefinition: workflowDef, patches };
        } else {
          updated.push({ role: 'assistant', content: fullContent, workflowDefinition: workflowDef, patches });
        }
        return updated;
      });

      return workflowDef;
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('AI Flow chat error:', err);
        setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}` }]);
      }
      return undefined;
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  }, [messages.length, getAuthHeaders]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    conversationRef.current = [];
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  const stopGeneration = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsGenerating(false);
  }, []);

  const setCanvasContext = useCallback((canvas: CanvasContext | null, execution?: ExecutionContext | null, rawDef?: { nodes: any[]; edges: any[] } | null) => {
    canvasContextRef.current = canvas;
    if (execution !== undefined) executionContextRef.current = execution;
    if (rawDef !== undefined) rawDefinitionRef.current = rawDef;
  }, []);

  // Listen for aiBuilderSendMessage events (e.g. from "Fix with AI" on failed nodes)
  useEffect(() => {
    const handleAutoSend = (e: CustomEvent) => {
      const { message } = e.detail;
      if (message) {
        sendMessage(message);
      }
    };
    window.addEventListener('aiBuilderSendMessage', handleAutoSend as any);
    return () => window.removeEventListener('aiBuilderSendMessage', handleAutoSend as any);
  }, [sendMessage]);

  return { messages, isGenerating, sendMessage, clearMessages, stopGeneration, setCanvasContext };
}
