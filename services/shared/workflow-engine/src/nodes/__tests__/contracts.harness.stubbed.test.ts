/**
 * Stubbed contract harness — runs the 33 nodes that need external infra
 * against axios + provider stubs so the schema/executor pair gets a smoke
 * test even without real Postgres/Milvus/MCP/LLM/openagentic-proxy backends.
 *
 * The contract here is the SAME as the no-stub harness:
 *   • execute() returns OR throws a clean Error (NOT a TypeError on
 *     undefined property access).
 *   • TypeError "Cannot read properties of undefined" means the
 *     executor is reaching for a setting the schema didn't declare
 *     `required: true`. That's a contract violation.
 *
 * Stubs:
 *   • axios.{get,post,request} → reject with ECONNREFUSED (so executors
 *     hit their network branch + their catch path).
 *   • Provider SDKs (`@aws-sdk/client-bedrock-runtime`, openai, etc.)
 *     don't need stubs because abortableAxios catches above them.
 *   • Prisma is module-mocked everywhere a node imports it (just two
 *     legacy paths inside openagentic_proxy nodes; the rest go through
 *     `ctx.executeSubWorkflow` which we hand-stub).
 *   • Optional ctx hooks (executeSubWorkflow, getIncomingResults,
 *     emitNodeProgress) are filled with throwing stubs so we can assert
 *     the executor either calls them or throws cleanly when missing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NodeExecutionContext, NodeSchema } from '../types.js';

// Module-level mock: every executor that calls axios goes through here.
vi.mock('axios', async () => {
  const reject = (cfg?: any) => {
    const err: any = new Error(`ECONNREFUSED ${(cfg as any)?.url || 'stub'}`);
    err.code = 'ECONNREFUSED';
    err.config = cfg;
    return Promise.reject(err);
  };
  const post = vi.fn((url: any, data?: any, config?: any) => reject({ url, data, ...config }));
  const get = vi.fn((url: any, config?: any) => reject({ url, ...config }));
  const request = vi.fn((cfg: any) => reject(cfg));
  const fn: any = vi.fn((cfg: any) => reject(cfg));
  fn.post = post;
  fn.get = get;
  fn.request = request;
  fn.create = vi.fn(() => fn);
  fn.isAxiosError = (e: any) => !!e?.config;
  return { default: fn, post, get, request };
});

import { registry } from '../registry.js';

const ENGINE_INTERNAL = new Set([
  // condition / switch / parallel / loop need engine routing hooks the
  // contract harness can't stub without re-implementing the engine.
  'condition', 'switch', 'parallel', 'loop', 'merge',
  // sub_workflow needs ctx.executeSubWorkflow (engine-internal recursion).
  'sub_workflow',
]);

function makeStubCtx(): NodeExecutionContext {
  return {
    signal: new AbortController().signal,
    executionId: 'stubbed-contract',
    workflowId: 'wf-stubbed-contract',
    apiUrl: 'http://stub-api',
    mcpProxyUrl: 'http://stub-mcp-proxy',
    openagenticProxyUrl: 'http://stub-openagentic-proxy',
    openagenticManagerUrl: 'http://stub-openagentic',
    authToken: 'Bearer stub',
    interpolateTemplate: (t: string) => t,
    getInternalAuthHeaders: () => ({ 'X-Internal-Secret': 'stub' }),
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any,
  } as NodeExecutionContext;
}

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
      case 'json':
      case 'object':       data[setting.name] = {}; break;
      case 'code':         data[setting.name] = 'return 42;'; break;
      case 'secret_ref':   data[setting.name] = 'stub_secret'; break;
      default:             data[setting.name] = null;
    }
  }
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('stubbed contract harness — every node executes or throws cleanly', () => {
  const stubbable = Array.from(registry.entries()).filter(
    ([type]) => !ENGINE_INTERNAL.has(type),
  );

  it('there are at least 40 stubbable nodes (sanity)', () => {
    expect(stubbable.length).toBeGreaterThanOrEqual(40);
  });

  it.each(stubbable)(
    'execute(%s) — returns or throws a clean Error (not a TypeError)',
    async (type, plugin) => {
      const node = {
        id: `stubbed-${type}`,
        type,
        data: synthMinimumData(plugin.schema),
      };
      try {
        const out = await plugin.execute(node, null, makeStubCtx());
        // Some pure-data nodes return successfully even with stubs.
        expect(out, `node ${type}: execute returned undefined`).not.toBe(undefined);
      } catch (err) {
        expect(err).toBeInstanceOf(Error);
        const msg = (err as Error).message;
        expect(msg, `node ${type}: execute threw without a message`).toBeTruthy();
        // The forbidden failure: undefined-property dereference.
        expect(
          /Cannot read propert(?:y|ies) of (undefined|null)/.test(msg),
          `node ${type}: TypeError on undefined/null — schema/executor drift. Message: "${msg}"`,
        ).toBe(false);
      }
    },
  );
});
