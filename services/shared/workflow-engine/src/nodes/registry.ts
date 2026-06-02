/**
 * Node Plugin Registry — schema-driven node definitions.
 *
 * The registry is the single source of truth for all *migrated* nodes.
 * It is populated at module load via static imports (intentionally simple
 * — no fs scanning, no dynamic require — so it works identically in dev
 * (`tsx watch`) and prod (compiled `dist/`)).
 *
 * To add a new migrated node:
 *   1. Create `src/nodes/<type>/schema.json` and `src/nodes/<type>/executor.ts`.
 *   2. Add an `import` + `register()` call below.
 *   3. Write `src/nodes/<type>/executor.test.ts`.
 *
 * That's it. No edits to compiler, engine, palette, or AI Flow Builder needed.
 *
 * Unmigrated node types stay on the legacy switch in
 * WorkflowExecutionEngine.executeNodeCore + WorkflowCompiler.validateNodeData.
 */

import type {
  NodePlugin,
  NodeSchema,
  NodeExecutionContext,
  WorkflowNode,
} from './types.js';
import { OutputAssertionError } from './types.js';

// ---------------------------------------------------------------------------
// Static imports — one block per migrated node
// ---------------------------------------------------------------------------

import textSchemaJson from './text/schema.json' with { type: 'json' };
import { execute as textExecute } from './text/executor.js';

import httpRequestSchemaJson from './http_request/schema.json' with { type: 'json' };
import { execute as httpRequestExecute } from './http_request/executor.js';

import llmCompletionSchemaJson from './llm_completion/schema.json' with { type: 'json' };
import { execute as llmCompletionExecute } from './llm_completion/executor.js';

import waitSchemaJson from './wait/schema.json' with { type: 'json' };
import { execute as waitExecute } from './wait/executor.js';

import transformSchemaJson from './transform/schema.json' with { type: 'json' };
import { execute as transformExecute } from './transform/executor.js';

import mergeSchemaJson from './merge/schema.json' with { type: 'json' };
import { execute as mergeExecute } from './merge/executor.js';

import webhookResponseSchemaJson from './webhook_response/schema.json' with { type: 'json' };
import { execute as webhookResponseExecute } from './webhook_response/executor.js';

import errorHandlerSchemaJson from './error_handler/schema.json' with { type: 'json' };
import { execute as errorHandlerExecute } from './error_handler/executor.js';

// Batch 2 — integration nodes (notifications, ticketing, messaging, email).
import slackMessageSchemaJson from './slack_message/schema.json' with { type: 'json' };
import { execute as slackMessageExecute } from './slack_message/executor.js';

import teamsMessageSchemaJson from './teams_message/schema.json' with { type: 'json' };
import { execute as teamsMessageExecute } from './teams_message/executor.js';

import discordMessageSchemaJson from './discord_message/schema.json' with { type: 'json' };
import { execute as discordMessageExecute } from './discord_message/executor.js';

import outlookEmailSchemaJson from './outlook_email/schema.json' with { type: 'json' };
import { execute as outlookEmailExecute } from './outlook_email/executor.js';

import sendEmailSchemaJson from './send_email/schema.json' with { type: 'json' };
import { execute as sendEmailExecute } from './send_email/executor.js';

import pagerdutyIncidentSchemaJson from './pagerduty_incident/schema.json' with { type: 'json' };
import { execute as pagerdutyIncidentExecute } from './pagerduty_incident/executor.js';

import servicenowTicketSchemaJson from './servicenow_ticket/schema.json' with { type: 'json' };
import { execute as servicenowTicketExecute } from './servicenow_ticket/executor.js';

import jiraIssueSchemaJson from './jira_issue/schema.json' with { type: 'json' };
import { execute as jiraIssueExecute } from './jira_issue/executor.js';

// Batch 2 — data / RAG nodes (knowledge ingestion, embeddings, vector store, search).
import knowledgeIngestSchemaJson from './knowledge_ingest/schema.json' with { type: 'json' };
import { execute as knowledgeIngestExecute } from './knowledge_ingest/executor.js';

import fileUploadSchemaJson from './file_upload/schema.json' with { type: 'json' };
import { execute as fileUploadExecute } from './file_upload/executor.js';

import documentLoaderSchemaJson from './document_loader/schema.json' with { type: 'json' };
import { execute as documentLoaderExecute } from './document_loader/executor.js';

import embeddingSchemaJson from './embedding/schema.json' with { type: 'json' };
import { execute as embeddingExecute } from './embedding/executor.js';

import textSplitterSchemaJson from './text_splitter/schema.json' with { type: 'json' };
import { execute as textSplitterExecute } from './text_splitter/executor.js';

import vectorStoreSchemaJson from './vector_store/schema.json' with { type: 'json' };
import { execute as vectorStoreExecute } from './vector_store/executor.js';

import ragQuerySchemaJson from './rag_query/schema.json' with { type: 'json' };
import { execute as ragQueryExecute } from './rag_query/executor.js';

// Batch 3 — SIEM / observability integrations.
import splunkSearchSchemaJson from './splunk_search/schema.json' with { type: 'json' };
import { execute as splunkSearchExecute } from './splunk_search/executor.js';

// Batch 3 — LLM provider variants + MCP tool node.
import bedrockSchemaJson from './bedrock/schema.json' with { type: 'json' };
import { execute as bedrockExecute } from './bedrock/executor.js';

import vertexSchemaJson from './vertex/schema.json' with { type: 'json' };
import { execute as vertexExecute } from './vertex/executor.js';

import azureAiSchemaJson from './azure_ai/schema.json' with { type: 'json' };
import { execute as azureAiExecute } from './azure_ai/executor.js';

import openagenticChatSchemaJson from './openagentic_chat/schema.json' with { type: 'json' };
import { execute as openagenticChatExecute } from './openagentic_chat/executor.js';

import reasoningSchemaJson from './reasoning/schema.json' with { type: 'json' };
import { execute as reasoningExecute } from './reasoning/executor.js';

import structuredOutputSchemaJson from './structured_output/schema.json' with { type: 'json' };
import { execute as structuredOutputExecute } from './structured_output/executor.js';

import guardrailsSchemaJson from './guardrails/schema.json' with { type: 'json' };
import { execute as guardrailsExecute } from './guardrails/executor.js';

import mcpToolSchemaJson from './mcp_tool/schema.json' with { type: 'json' };
import { execute as mcpToolExecute } from './mcp_tool/executor.js';

import k8sSandboxRunSchemaJson from './k8s_sandbox_run/schema.json' with { type: 'json' };
import { execute as k8sSandboxRunExecute } from './k8s_sandbox_run/executor.js';

// Batch 4 — agent nodes (the "fake success" smoking gun). Every node here
// declares outputAssertions that catch agents returning empty / refusal /
// failed-status responses, so the engine emits node_error with reason=
// 'output_failed_assertion' instead of treating an unhelpful answer as success.
import agentSpawnSchemaJson from './agent_spawn/schema.json' with { type: 'json' };
import { execute as agentSpawnExecute } from './agent_spawn/executor.js';

import a2aSchemaJson from './a2a/schema.json' with { type: 'json' };
import { execute as a2aExecute } from './a2a/executor.js';

import agentSingleSchemaJson from './agent_single/schema.json' with { type: 'json' };
import { execute as agentSingleExecute } from './agent_single/executor.js';

import agentPoolSchemaJson from './agent_pool/schema.json' with { type: 'json' };
import { execute as agentPoolExecute } from './agent_pool/executor.js';

import agentSupervisorSchemaJson from './agent_supervisor/schema.json' with { type: 'json' };
import { execute as agentSupervisorExecute } from './agent_supervisor/executor.js';

import multiAgentSchemaJson from './multi_agent/schema.json' with { type: 'json' };
import { execute as multiAgentExecute } from './multi_agent/executor.js';

// Batch 5 — entry-point + per-user data + recursive composition (Task #15).
// Closes the "fake success" gap for the four nodes that previously had no
// outputAssertions: trigger (no input), user_context (api error), data_query
// (zero hits), sub_workflow (no output).
import triggerSchemaJson from './trigger/schema.json' with { type: 'json' };
import { execute as triggerExecute } from './trigger/executor.js';

import userContextSchemaJson from './user_context/schema.json' with { type: 'json' };
import { execute as userContextExecute } from './user_context/executor.js';

import dataQuerySchemaJson from './data_query/schema.json' with { type: 'json' };
import { execute as dataQueryExecute } from './data_query/executor.js';

import subWorkflowSchemaJson from './sub_workflow/schema.json' with { type: 'json' };
import { execute as subWorkflowExecute } from './sub_workflow/executor.js';

// Batch 6 — human-in-the-loop + alternate datasource query. Closes the
// remainder of the easier unmigrated set: human_approval (with `approval` as
// an alias so saved flows + seed templates keep working) and the
// data_source_query node that proxies to the api's /api/data-sources/.../query
// endpoint (distinct from data_query which hits the vector search endpoint).
import humanApprovalSchemaJson from './human_approval/schema.json' with { type: 'json' };
import { execute as humanApprovalExecute } from './human_approval/executor.js';

// human_input / request_data — HITL DATA-REQUEST node (sister of human_approval).
// Pauses the flow, emits a typed form, resumes with the user's values.
import humanInputSchemaJson from './human_input/schema.json' with { type: 'json' };
import { execute as humanInputExecute } from './human_input/executor.js';

import dataSourceQuerySchemaJson from './data_source_query/schema.json' with { type: 'json' };
import { execute as dataSourceQueryExecute } from './data_source_query/executor.js';

// Batch 7 — control flow (Task #45). condition / switch / parallel / loop
// all moved off the legacy engine switch via the new ctx hooks
// (routeBranches / fanOutBranches / iterateOver). The executors own the
// routing / fan-out / iteration decisions; the engine wires the hooks to
// notifySkippedBranch + executeNode + Promise.allSettled the same way the
// legacy methods did.
import conditionSchemaJson from './condition/schema.json' with { type: 'json' };
import { execute as conditionExecute } from './condition/executor.js';

import switchSchemaJson from './switch/schema.json' with { type: 'json' };
import { execute as switchExecute } from './switch/executor.js';

import parallelSchemaJson from './parallel/schema.json' with { type: 'json' };
import { execute as parallelExecute } from './parallel/executor.js';

import loopSchemaJson from './loop/schema.json' with { type: 'json' };
import { execute as loopExecute } from './loop/executor.js';

// Batch 8 — code (JS sandbox) and openagentic (isolated code-manager
// sessions) close the code-execution gap. After this batch the schema-driven
// registry covers 100% of node types — the legacy switch/case lives on only
// as dead-code historical reference.
import codeSchemaJson from './code/schema.json' with { type: 'json' };
import { execute as codeExecute } from './code/executor.js';

import openagenticSchemaJson from './openagentic/schema.json' with { type: 'json' };
import { execute as openagenticExecute } from './openagentic/executor.js';

// Batch 9 — AIOps capability nodes (audit AUDIT-2026-05-03 punch list).
// anomaly_detect is the keystone: other AIOps capabilities (policy_guard,
// change_correlation, runbook_executor) compose off its hasAnomaly verdict.
import anomalyDetectSchemaJson from './anomaly_detect/schema.json' with { type: 'json' };
import { execute as anomalyDetectExecute } from './anomaly_detect/executor.js';

// Batch 10 — output_parser split (gap analysis 2026-05-14, P0 #4). Five
// typed processing primitives that replace transform's JS-expression-only
// path: filter_data / select_data / extract_key / parse_json / regex.
// Semantic reference: Langflow src/lfx/src/lfx/components/processing/.
import filterDataSchemaJson from './filter_data/schema.json' with { type: 'json' };
import { execute as filterDataExecute } from './filter_data/executor.js';

import selectDataSchemaJson from './select_data/schema.json' with { type: 'json' };
import { execute as selectDataExecute } from './select_data/executor.js';

import extractKeySchemaJson from './extract_key/schema.json' with { type: 'json' };
import { execute as extractKeyExecute } from './extract_key/executor.js';

import parseJsonSchemaJson from './parse_json/schema.json' with { type: 'json' };
import { execute as parseJsonExecute } from './parse_json/executor.js';

import regexSchemaJson from './regex/schema.json' with { type: 'json' };
import { execute as regexExecute } from './regex/executor.js';

// Batch 11 — gap-analysis 2026-05-14 P0 #1: prompt_template (reusable prompt
// builder with {{variable}} substitution + optional chat-message segmentation).
import promptTemplateSchemaJson from './prompt_template/schema.json' with { type: 'json' };
import { execute as promptTemplateExecute } from './prompt_template/executor.js';

// Batch 11 — gap-analysis 2026-05-14 P0 #2: conversation_memory (read /
// write / clear / summarize a tenant-scoped chat history backing stateful
// agents and HITL flows).
import conversationMemorySchemaJson from './conversation_memory/schema.json' with { type: 'json' };
import { execute as conversationMemoryExecute } from './conversation_memory/executor.js';

// Batch 11 — gap-analysis 2026-05-14 P0 #3: flow_tool (wrap a saved Flow
// as a callable tool with arg-mapping + output-extraction + recursion guard).
import flowToolSchemaJson from './flow_tool/schema.json' with { type: 'json' };
import { execute as flowToolExecute } from './flow_tool/executor.js';

// Batch 12 — gap-analysis 2026-05-14 P1 #3: wait_for (poll-until-condition
// with timeout). Sister to the existing `wait` (fixed-duration) primitive.
import waitForSchemaJson from './wait_for/schema.json' with { type: 'json' };
import { execute as waitForExecute } from './wait_for/executor.js';

// Batch 13 — gap-analysis 2026-05-14 P1 #9: rate_limiter (fixed-window
// throttle for fan-out to rate-limited APIs).
import rateLimiterSchemaJson from './rate_limiter/schema.json' with { type: 'json' };
import { execute as rateLimiterExecute } from './rate_limiter/executor.js';

// Batch 14 — gap-analysis 2026-05-14 P1 #6: csv_processor (text-mode CSV
// parsing). Binary/file mode deferred until binary data plane lands.
import csvProcessorSchemaJson from './csv_processor/schema.json' with { type: 'json' };
import { execute as csvProcessorExecute } from './csv_processor/executor.js';

// Batch 15 — 2026-05-15: grounding_check (deterministic fact-check that
// pins LLM claims to upstream truth sources, no second LLM call).
// Closes the "model invented a Redis crash that didn't happen" failure
// mode observed in cluster-triage-watchdog with gpt-oss:20b.
import groundingCheckSchemaJson from './grounding_check/schema.json' with { type: 'json' };
import { execute as groundingCheckExecute } from './grounding_check/executor.js';

// Batch 16 — 2026-05-15: llm_router (LLM-as-condition). Closes the
// flowbuilder-gap-analysis P1.3 gap: condition + condition routing for
// natural-language criteria where JS expressions can't express the
// classification. Goes through the SAME /v1/chat/completions endpoint
// llm_completion uses — never bypasses into chatmode's V3 pipeline.
import llmRouterSchemaJson from './llm_router/schema.json' with { type: 'json' };
import { execute as llmRouterExecute } from './llm_router/executor.js';

// Batch 17 — 2026-05-15: save_file (P1.15). Wraps ctx.persistArtifact
// (same hook webhook_response uses) so flows can write arbitrary text
// payloads to the platform's blob store and emit a stable deep-link.
// Text mode only — binary mode lands when the binary data plane (Tier
// 2 #5) is wired through.
import saveFileSchemaJson from './save_file/schema.json' with { type: 'json' };
import { execute as saveFileExecute } from './save_file/executor.js';

// Batch 18 — 2026-05-15: aggregate (P1.16, LLM-driven reduce). Same
// /v1/chat/completions endpoint as llm_completion / llm_router. Modes:
// reduce (one call over whole array) and map (N calls, one per item).
import aggregateSchemaJson from './aggregate/schema.json' with { type: 'json' };
import { execute as aggregateExecute } from './aggregate/executor.js';

// Batch 19 — 2026-05-15: knowledge_search (P1.17). Bridges the
// knowledge_ingest → search round-trip: ingest writes to shared_knowledge
// (alias 'shared') / user_<id>_private (alias 'private'); this node reads
// from those same collections via /api/chat/knowledge/search. rag_query
// targets a disjoint Milvus collection set (code_embeddings/doc_embeddings/
// user_memories) so it can't see content this flow just ingested — hence
// the separate primitive.
import knowledgeSearchSchemaJson from './knowledge_search/schema.json' with { type: 'json' };
import { execute as knowledgeSearchExecute } from './knowledge_search/executor.js';

// Batch 20 — 2026-05-31: RAG quality nodes (flows-overhaul Wave A #6). rerank
// re-orders retrieved chunks by lexical relevance (deterministic BM25-style
// scorer, no model round-trip) and keeps top-N; multi_query expands one
// question into N retrieval query variants (deterministic rule-based
// reformulation) to widen recall before retrieval. Both are pure/deterministic
// so the RAG harness is reproducible without a live model dependency.
import rerankSchemaJson from './rerank/schema.json' with { type: 'json' };
import { execute as rerankExecute } from './rerank/executor.js';

import multiQuerySchemaJson from './multi_query/schema.json' with { type: 'json' };
import { execute as multiQueryExecute } from './multi_query/executor.js';

// Batch 21 — 2026-06-01: missing control-flow primitives (flows-deep gap
// analysis). retry_with_backoff wraps a downstream op with exponential-backoff
// retry; map_reduce fans out the downstream subgraph per item (bounded
// concurrency) then reduces; dedup is an idempotency gate keyed by a config
// expression (execution-scoped by default, optional TTL for cross-execution).
import retryWithBackoffSchemaJson from './retry_with_backoff/schema.json' with { type: 'json' };
import { execute as retryWithBackoffExecute } from './retry_with_backoff/executor.js';

import mapReduceSchemaJson from './map_reduce/schema.json' with { type: 'json' };
import { execute as mapReduceExecute } from './map_reduce/executor.js';

import dedupSchemaJson from './dedup/schema.json' with { type: 'json' };
import { execute as dedupExecute } from './dedup/executor.js';

// ---------------------------------------------------------------------------
// Registry table
// ---------------------------------------------------------------------------

export const registry: Map<string, NodePlugin> = new Map();

function register(schemaJson: unknown, execute: NodePlugin['execute']): void {
  const schema = schemaJson as NodeSchema;
  if (registry.has(schema.type)) {
    throw new Error(`[node-registry] Duplicate node type: ${schema.type}`);
  }
  registry.set(schema.type, { schema, execute });
}

// Register a second node type that reuses an existing plugin's executor and
// outputAssertions but exposes itself under a different `type` string. Used
// when the legacy engine routed two type names to the same handler (e.g.
// `openagentic_llm` and `openagentic_chat` both ran executeOpenAgenticLLMNode);
// the alias keeps both type strings working in saved flows + templates while
// the refusal-detection assertions stay defined in one place.
function registerAlias(
  originalSchemaJson: unknown,
  aliasType: string,
  aliasLabel: string,
  execute: NodePlugin['execute'],
): void {
  if (registry.has(aliasType)) {
    throw new Error(`[node-registry] Duplicate node type: ${aliasType}`);
  }
  const original = originalSchemaJson as NodeSchema;
  const aliased: NodeSchema = { ...original, type: aliasType, label: aliasLabel };
  registry.set(aliasType, { schema: aliased, execute });
}

// Register the pilot 3.
register(textSchemaJson, textExecute);
register(httpRequestSchemaJson, httpRequestExecute);
register(llmCompletionSchemaJson, llmCompletionExecute);

// Batch 1 — control flow + simple integration (5 fully migrated).
register(waitSchemaJson, waitExecute);
register(transformSchemaJson, transformExecute);
register(mergeSchemaJson, mergeExecute);
register(webhookResponseSchemaJson, webhookResponseExecute);
register(errorHandlerSchemaJson, errorHandlerExecute);
// condition, switch, parallel: deferred — routing is tightly coupled to
// engine graph traversal (outgoingEdges, executeNode, notifySkippedBranch).

// Batch 2 — integration nodes (8 of 15).
register(slackMessageSchemaJson, slackMessageExecute);
register(teamsMessageSchemaJson, teamsMessageExecute);
register(discordMessageSchemaJson, discordMessageExecute);
register(outlookEmailSchemaJson, outlookEmailExecute);
register(sendEmailSchemaJson, sendEmailExecute);
register(pagerdutyIncidentSchemaJson, pagerdutyIncidentExecute);
register(servicenowTicketSchemaJson, servicenowTicketExecute);
register(jiraIssueSchemaJson, jiraIssueExecute);

// Batch 2 — data / RAG nodes (7 of 15).
register(knowledgeIngestSchemaJson, knowledgeIngestExecute);
register(fileUploadSchemaJson, fileUploadExecute);
register(documentLoaderSchemaJson, documentLoaderExecute);
register(embeddingSchemaJson, embeddingExecute);
register(textSplitterSchemaJson, textSplitterExecute);
register(vectorStoreSchemaJson, vectorStoreExecute);
register(ragQuerySchemaJson, ragQueryExecute);

// Batch 3 — SIEM / observability integrations.
register(splunkSearchSchemaJson, splunkSearchExecute);

// Batch 3 — LLM provider variants + MCP tool node (8 nodes).
register(bedrockSchemaJson, bedrockExecute);
register(vertexSchemaJson, vertexExecute);
register(azureAiSchemaJson, azureAiExecute);
register(openagenticChatSchemaJson, openagenticChatExecute);
// openagentic_llm shares everything (executor + outputAssertions including
// the refusal-detection regex) with openagentic_chat — the legacy switch
// routed both type strings through executeOpenAgenticLLMNode. Saved flows
// and seed templates use type='openagentic_llm', so the alias keeps them
// working without forcing a data migration.
registerAlias(
  openagenticChatSchemaJson,
  'openagentic_llm',
  'OpenAgentic LLM',
  openagenticChatExecute,
);
register(reasoningSchemaJson, reasoningExecute);
register(structuredOutputSchemaJson, structuredOutputExecute);
register(guardrailsSchemaJson, guardrailsExecute);
register(mcpToolSchemaJson, mcpToolExecute);

// K8s sandbox run — ephemeral namespace workload runner.
register(k8sSandboxRunSchemaJson, k8sSandboxRunExecute);

// Batch 4 — agent nodes (6 nodes, fake-success outputAssertions).
register(agentSpawnSchemaJson, agentSpawnExecute);
register(a2aSchemaJson, a2aExecute);
register(agentSingleSchemaJson, agentSingleExecute);
register(agentPoolSchemaJson, agentPoolExecute);
register(agentSupervisorSchemaJson, agentSupervisorExecute);
register(multiAgentSchemaJson, multiAgentExecute);

// Batch 5 — entry-point + per-user data + recursive composition (Task #15).
register(triggerSchemaJson, triggerExecute);
register(userContextSchemaJson, userContextExecute);
register(dataQuerySchemaJson, dataQueryExecute);
register(subWorkflowSchemaJson, subWorkflowExecute);

// Batch 6 — human-in-the-loop + alternate datasource query (Task #15).
register(humanApprovalSchemaJson, humanApprovalExecute);
// `approval` shares the entire plugin (executor + outputAssertions) with
// `human_approval` — the legacy switch routed both type strings through
// executeApprovalNode. Saved flows and seed templates use either string;
// the alias keeps both working without a data migration.
registerAlias(
  humanApprovalSchemaJson,
  'approval',
  'Approval',
  humanApprovalExecute,
);

// human_input — HITL data-request. `request_data` aliases the same plugin so
// either type string works in saved flows + templates (mirrors approval/human_approval).
register(humanInputSchemaJson, humanInputExecute);
registerAlias(
  humanInputSchemaJson,
  'request_data',
  'Request Data from User',
  humanInputExecute,
);

register(dataSourceQuerySchemaJson, dataSourceQueryExecute);

// Batch 7 — control flow (Task #45). The four legacy "private executeXxxNode"
// methods are now schema-driven plugins; the engine wires the new
// NodeExecutionContext hooks (routeBranches / fanOutBranches / iterateOver)
// so notifySkippedBranch + executeNode + Promise.allSettled stay engine-side.
register(conditionSchemaJson, conditionExecute);
register(switchSchemaJson, switchExecute);
register(parallelSchemaJson, parallelExecute);
register(loopSchemaJson, loopExecute);

// Batch 8 — code + openagentic bring schema coverage to 100%.
register(codeSchemaJson, codeExecute);
register(openagenticSchemaJson, openagenticExecute);

// Batch 9 — AIOps capability nodes
register(anomalyDetectSchemaJson, anomalyDetectExecute);

// Batch 10 — output_parser split (5 typed processing primitives).
register(filterDataSchemaJson, filterDataExecute);
register(selectDataSchemaJson, selectDataExecute);
register(extractKeySchemaJson, extractKeyExecute);
register(parseJsonSchemaJson, parseJsonExecute);
register(regexSchemaJson, regexExecute);

// Batch 11 — gap-analysis 2026-05-14 P0 #1.
register(promptTemplateSchemaJson, promptTemplateExecute);

// Batch 11 — gap-analysis 2026-05-14 P0 #2.
register(conversationMemorySchemaJson, conversationMemoryExecute);

// Batch 11 — gap-analysis 2026-05-14 P0 #3.
register(flowToolSchemaJson, flowToolExecute);

// Batch 12 — gap-analysis 2026-05-14 P1 #3.
register(waitForSchemaJson, waitForExecute);
register(rateLimiterSchemaJson, rateLimiterExecute);
register(csvProcessorSchemaJson, csvProcessorExecute);
register(groundingCheckSchemaJson, groundingCheckExecute);
register(llmRouterSchemaJson, llmRouterExecute);
register(saveFileSchemaJson, saveFileExecute);
register(aggregateSchemaJson, aggregateExecute);
register(knowledgeSearchSchemaJson, knowledgeSearchExecute);

// Batch 20 — RAG quality nodes (flows-overhaul Wave A #6). Deterministic
// (no model round-trip on the default path) so the RAG harness is reproducible.
register(rerankSchemaJson, rerankExecute);
register(multiQuerySchemaJson, multiQueryExecute);

// Batch 21 — missing control-flow primitives (2026-06-01).
register(retryWithBackoffSchemaJson, retryWithBackoffExecute);
register(mapReduceSchemaJson, mapReduceExecute);
register(dedupSchemaJson, dedupExecute);

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/** Returns all registered (migrated) node types. */
export function getRegisteredTypes(): string[] {
  return Array.from(registry.keys());
}

/** Returns all schemas — used by the GET /node-schemas endpoint. */
export function getAllSchemas(): NodeSchema[] {
  return Array.from(registry.values()).map(p => p.schema);
}

/**
 * Generate the AI Flow Builder system-prompt fragment for all migrated nodes.
 * This replaces the hand-maintained list at useAIFlowChat.ts:28-86 once the
 * frontend reads it from the registry. The format is markdown bullets keyed
 * by category, mirroring the existing fragment shape.
 */
export function generateAiPromptFragment(): string {
  const lines: string[] = [];
  // Group by category — same shape as the legacy hand-maintained prompt.
  const byCategory = new Map<string, NodeSchema[]>();
  for (const plugin of registry.values()) {
    const cat = plugin.schema.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(plugin.schema);
  }

  for (const [category, schemas] of byCategory) {
    lines.push(`### ${category[0].toUpperCase()}${category.slice(1)}`);
    for (const schema of schemas) {
      const ai = schema.ai;
      if (!ai) continue;
      const settingsList = (schema.settings ?? [])
        .map(s => s.name + (s.required ? '*' : ''))
        .join(', ');
      lines.push(
        `- **${schema.type}** — ${ai.shortDescription}. data: { ${settingsList} }. ${ai.whenToUse}` +
          (ai.promptHints ? ` HINT: ${ai.promptHints}` : ''),
      );
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

// ---------------------------------------------------------------------------
// runWithAssertions — run an executor and post-validate its output
// ---------------------------------------------------------------------------

/**
 * Execute a registered plugin and validate the result against its
 * schema.outputAssertions. Throws OutputAssertionError on the FIRST
 * failing assertion. Executor errors pass through unchanged.
 *
 * Assertion expressions run in a sandboxed Function — they have access
 * only to a parameter named `result` (the executor's return value). No
 * closure over engine state, no globals beyond standard ECMAScript.
 */
export async function runWithAssertions(
  plugin: NodePlugin,
  node: WorkflowNode,
  input: unknown,
  ctx: NodeExecutionContext,
): Promise<unknown> {
  const result = await plugin.execute(node, input, ctx);

  const assertions = plugin.schema.outputAssertions ?? [];
  for (const assertion of assertions) {
    let pass: unknown;
    try {
      // eslint-disable-next-line no-new-func -- intentional sandboxed evaluator
      const fn = new Function('result', `"use strict"; return (${assertion.expression});`);
      pass = fn(result);
    } catch (err: any) {
      // A throw inside the expression is treated as a failed assertion.
      throw new OutputAssertionError({
        failedAssertion: assertion.name,
        errorMessage: `${assertion.errorMessage} (assertion threw: ${err?.message ?? err})`,
        nodeOutput: result,
      });
    }
    if (!pass) {
      throw new OutputAssertionError({
        failedAssertion: assertion.name,
        errorMessage: assertion.errorMessage,
        nodeOutput: result,
      });
    }
  }

  return result;
}
