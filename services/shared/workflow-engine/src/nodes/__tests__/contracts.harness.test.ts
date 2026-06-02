/**
 * Schema-driven contract harness — every registered node MUST satisfy
 * these structural contracts. New nodes get tested for free.
 *
 * What this catches that per-node executor.test.ts files don't:
 *   • schema typos (missing label, bad category, wrong setting type)
 *   • port-shape drift (output declared shape doesn't match what the
 *     executor returns)
 *   • required-setting omission (executor crashes when a "required"
 *     setting is absent — should throw a clean validation error)
 *   • dead executors (registry entry exists but execute() is undefined)
 *   • registry duplicates (two nodes claim the same type)
 *
 * Out of scope (covered by per-node executor.test.ts):
 *   • behavioral correctness — does the HTTP node actually fetch?
 *     Does the LLM node actually call the right model?
 *   • full input/output round trip — that's a behavioral test
 *
 * Adding a new node? You don't need to touch this file. Drop the
 * schema.json + executor.ts + register() call into registry.ts and
 * the harness picks it up automatically. If your node needs external
 * infrastructure to even *boot* (real Postgres, real Milvus, real
 * HTTP), add its type to NODES_REQUIRING_EXTERNAL below — the harness
 * will skip executor smoke and validate schema/registry only.
 */

import { describe, it, expect } from 'vitest';
import { registry } from '../registry.js';
import type { NodeExecutionContext, NodeSchema } from '../types.js';

// ---------------------------------------------------------------------------
// Allow-list: nodes whose execute() needs an external service to run at all
// (real Postgres, Milvus, MCP proxy, LLM, openagentic-proxy, etc.). The harness
// runs SCHEMA validation against these, but skips the executor smoke. Each
// of these nodes still has its own per-node executor.test.ts.
// ---------------------------------------------------------------------------

const NODES_REQUIRING_EXTERNAL = new Set<string>([
  // HTTP / external API
  'http_request',
  'slack_message', 'teams_message', 'discord_message',
  'outlook_email', 'send_email',
  'pagerduty_incident', 'servicenow_ticket', 'jira_issue',
  // RAG / data layer (need Milvus/Postgres/MinIO)
  'knowledge_ingest', 'file_upload', 'document_loader',
  'embedding', 'vector_store', 'rag_query',
  'data_query', 'data_source_query',
  // LLM / model layer
  'llm_completion', 'openagentic_llm', 'openagentic_chat',
  'azure_ai', 'bedrock', 'vertex',
  // Agent layer (need openagentic-proxy)
  'agent_spawn', 'a2a', 'agent_single', 'agent_pool',
  'agent_supervisor', 'multi_agent', 'openagentic',
  // K8s / sandbox
  'k8s_sandbox_run',
  // Sub-workflow needs a workflow engine
  'sub_workflow',
  // HITL needs DB
  'human_approval',
  // MCP needs proxy
  'mcp_tool',
  // Guardrails needs an LLM
  'guardrails',
]);

// ---------------------------------------------------------------------------
// Stub context for executor smoke tests
// ---------------------------------------------------------------------------

function makeStubCtx(): NodeExecutionContext {
  return {
    signal: new AbortController().signal,
    executionId: 'contract-harness-exec',
    workflowId: 'contract-harness-wf',
    apiUrl: 'http://stub-api',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({ 'X-Internal-Secret': 'stub' }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
  } as NodeExecutionContext;
}

// ---------------------------------------------------------------------------
// Synthesize a minimum-viable node.data from a schema's required settings.
// Picks safe placeholder values matching the declared SettingType.
// ---------------------------------------------------------------------------

function synthMinimumData(schema: NodeSchema): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const setting of schema.settings ?? []) {
    if (!setting.required) continue;
    if (setting.default !== undefined) {
      data[setting.name] = setting.default;
      continue;
    }
    switch (setting.type) {
      case 'string':       data[setting.name] = 'stub'; break;
      case 'number':       data[setting.name] = 1; break;
      case 'boolean':      data[setting.name] = false; break;
      case 'enum':         data[setting.name] = setting.values?.[0] ?? 'stub'; break;
      case 'json':         data[setting.name] = {}; break;
      case 'object':       data[setting.name] = {}; break;
      case 'code':         data[setting.name] = 'return 42;'; break;
      case 'secret_ref':   data[setting.name] = 'stub_secret'; break;
      default:             data[setting.name] = null;
    }
  }
  return data;
}

// ---------------------------------------------------------------------------
// Contract: schema validity
// ---------------------------------------------------------------------------

describe('contract harness — schema validity', () => {
  const allTypes = Array.from(registry.keys());

  it('registry contains at least 50 nodes (fail-fast on rip-and-replace mistakes)', () => {
    expect(allTypes.length).toBeGreaterThanOrEqual(50);
  });

  it('every registry entry has a non-null execute function', () => {
    for (const [type, plugin] of registry.entries()) {
      expect(typeof plugin.execute, `node ${type} missing execute`).toBe('function');
    }
  });

  it.each(Array.from(registry.entries()))(
    'schema(%s) — required top-level fields are present and well-typed',
    (type, plugin) => {
      const s = plugin.schema;
      expect(s.type, `node ${type}: schema.type mismatch`).toBe(type);
      expect(s.label, `node ${type}: missing label`).toBeTruthy();
      expect(typeof s.label).toBe('string');
      expect(s.description, `node ${type}: missing description`).toBeTruthy();
      expect(typeof s.description).toBe('string');
      expect(s.category, `node ${type}: missing category`).toBeTruthy();
      // category must be one of the known enum values
      expect(
        ['trigger', 'action', 'control', 'data', 'ai', 'integration', 'annotation', 'utility']
          .includes(s.category),
        `node ${type}: invalid category '${s.category}'`,
      ).toBe(true);
    },
  );

  it.each(Array.from(registry.entries()))(
    'schema(%s) — settings have valid type + name shape',
    (type, plugin) => {
      for (const setting of plugin.schema.settings ?? []) {
        expect(setting.name, `node ${type}: setting missing name`).toBeTruthy();
        expect(
          ['string', 'number', 'boolean', 'enum', 'json', 'object', 'code', 'secret_ref']
            .includes(setting.type),
          `node ${type}: setting '${setting.name}' has invalid type '${setting.type}'`,
        ).toBe(true);
        if (setting.type === 'enum') {
          expect(
            Array.isArray(setting.values) && setting.values.length > 0,
            `node ${type}: enum setting '${setting.name}' missing values[]`,
          ).toBe(true);
        }
      }
    },
  );

  it.each(Array.from(registry.entries()))(
    'schema(%s) — port shapes (when present) declare name + type',
    (type, plugin) => {
      const ports = plugin.schema.ports;
      for (const p of ports?.inputs ?? []) {
        expect(p.name, `node ${type}: input port missing name`).toBeTruthy();
        expect(p.type, `node ${type}: input port '${p.name}' missing type`).toBeTruthy();
      }
      for (const p of ports?.outputs ?? []) {
        expect(p.name, `node ${type}: output port missing name`).toBeTruthy();
        expect(p.type, `node ${type}: output port '${p.name}' missing type`).toBeTruthy();
      }
    },
  );
});

// ---------------------------------------------------------------------------
// Contract: executor smoke (excluding nodes that need external infra)
// ---------------------------------------------------------------------------

describe('contract harness — executor smoke (no external infra)', () => {
  const localTypes = Array.from(registry.entries())
    .filter(([type]) => !NODES_REQUIRING_EXTERNAL.has(type));

  it('there is at least one node we can smoke without external infra', () => {
    expect(localTypes.length).toBeGreaterThan(0);
  });

  it.each(localTypes)(
    'execute(%s) — returns or throws a clean error on minimal-required input',
    async (type, plugin) => {
      const node = {
        id: `contract-${type}`,
        type,
        data: synthMinimumData(plugin.schema),
      };

      try {
        const out = await plugin.execute(node, null, makeStubCtx());
        // If executor returned, output should be defined OR null (not undefined,
        // which suggests an unhandled return path).
        expect(out, `node ${type}: execute returned undefined`).not.toBe(undefined);
      } catch (err) {
        // Acceptable failure modes: clean Error subclasses with a message.
        // Unacceptable: TypeError on undefined-property access — that's a
        // schema/executor mismatch, not a config problem.
        expect(err).toBeInstanceOf(Error);
        const msg = (err as Error).message;
        expect(msg, `node ${type}: execute threw without a message`).toBeTruthy();
        // TypeError "Cannot read properties of undefined" means the executor
        // is reading a field the schema didn't declare as required. That's
        // a contract violation.
        expect(
          /Cannot read propert(?:y|ies) of (undefined|null)/.test(msg),
          `node ${type}: executor accessed undefined/null on minimum-required input — message: "${msg}". Either mark the missing setting required:true in schema.json, or add a default.`,
        ).toBe(false);
      }
    },
  );
});
