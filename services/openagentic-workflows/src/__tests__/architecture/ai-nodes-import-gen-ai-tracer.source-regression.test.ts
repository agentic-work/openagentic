/**
 * Arch cage — every AI node executor MUST import + call the workflow-engine
 * `GenAITracer.withGenAISpan(...)` helper so OTel GenAI v1.37 spans + metric
 * instruments emit on every model call.
 *
 * Per OTel GenAI v1.37 spec §gen-ai-spans:
 *   https://opentelemetry.io/docs/specs/semconv/gen-ai/
 *
 * AI node set (16 — `openagentic_llm` is a registry alias for
 * `openagentic_chat`, not its own executor — verified in nodes/registry.ts):
 *
 * | Executor             | gen_ai.operation mapping                |
 * |----------------------|------------------------------------------|
 * | llm_completion       | chat                                     |
 * | openagentic_chat     | chat (and also serves openagentic_llm)   |
 * | azure_ai             | chat                                     |
 * | bedrock              | chat                                     |
 * | vertex               | chat                                     |
 * | reasoning            | chat                                     |
 * | structured_output    | chat                                     |
 * | synth                | chat                                     |
 * | guardrails           | chat                                     |
 * | agent_single         | agent                                    |
 * | agent_pool           | agent                                    |
 * | agent_spawn          | agent                                    |
 * | agent_supervisor     | agent                                    |
 * | multi_agent          | task_execution                           |
 * | embedding            | embeddings                               |
 * | rag_query            | embeddings (embedding portion)           |
 *
 * Why this cage matters:
 *   - Without it, a new AI node could ship without OTel emission. Operators
 *     would silently lose token-usage and operation-duration metrics for the
 *     new node — a regression that's invisible at code-review time.
 *   - The forward direction (every node imports the tracer) also pins the
 *     import path so refactors of GenAITracer don't accidentally break a
 *     subset of executors.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const NODES_ROOT = resolve(
  __dirname,
  '../../../../shared/workflow-engine/src/nodes',
);

const AI_NODES = [
  'llm_completion',
  'openagentic_chat',
  'azure_ai',
  'bedrock',
  'vertex',
  'reasoning',
  'structured_output',
  'synth',
  'guardrails',
  'agent_single',
  'agent_pool',
  'agent_spawn',
  'agent_supervisor',
  'multi_agent',
  'embedding',
  'rag_query',
];

describe('AI node executors emit OTel GenAI v1.37 spans + metrics', () => {
  for (const node of AI_NODES) {
    it(`${node}/executor.ts imports GenAITracer and calls withGenAISpan`, () => {
      const execPath = resolve(NODES_ROOT, node, 'executor.ts');
      expect(
        existsSync(execPath),
        `expected executor file at ${execPath}`,
      ).toBe(true);
      const content = readFileSync(execPath, 'utf8');

      // Import line — matches both `import { withGenAISpan } from '../../observability/GenAITracer.js'`
      // and the named-import variants the wire-in PR uses.
      expect(
        content,
        `${node}/executor.ts must import withGenAISpan from the workflow-engine GenAITracer helper`,
      ).toMatch(/from\s+['"][^'"]*observability\/GenAITracer(\.js)?['"]/);

      expect(
        content,
        `${node}/executor.ts must wrap its provider call in withGenAISpan(...)`,
      ).toMatch(/withGenAISpan\s*\(/);
    });
  }
});
