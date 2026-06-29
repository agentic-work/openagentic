/**
 * Architecture gate: TaskTool.ts MUST NOT carry an Anthropic-family
 * (`'sonnet' | 'opus' | 'haiku'`) enum on its `model` field.
 *
 * Live capture 2026-05-01:
 *   The chat main agent (running gpt-5.4 on AIF eastus2 — no Anthropic
 *   provider deployed) called `Task({subagent_type: "cloud-operations",
 *   model: "sonnet", …})`. The orchestrator routed `sonnet` against the
 *   live ProviderManager mapping which only knew gpt-5.4 +
 *   text-embedding-3-large. Result: `[Subagent] ReAct loop failed —
 *   "All providers failed. Original error: Request timeout"` after
 *   30 seconds (sub-agent never made a tool call, no real cost data).
 *
 * Root cause: TaskTool.ts hardcoded `model?: 'sonnet'|'opus'|'haiku'` in
 * the SubagentInput / SubagentSpec interfaces AND in the JSON schema's
 * `enum: ['sonnet','opus','haiku']`. That biased every LLM that read
 * the Task tool's schema toward Anthropic family names regardless of
 * which providers the platform actually had deployed. CLAUDE.md
 * `services/openagentic-api/CLAUDE.md` — "NO hardcoded model IDs
 * anywhere in source except UniversalEmbeddingService, ProviderManager,
 * LLMProviderSeeder, and env-var parsing helpers" — was being violated.
 *
 * Fix: type model as `string`, drop the enum, document that omitting
 * model falls through to agent definition preference → parent turn
 * default. Sub-agent dispatch stays correct on any provider mix.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const API_SRC = join(__dirname, '../..');

const TASKTOOL = join(API_SRC, 'services/TaskTool.ts');

describe('Architecture: TaskTool.ts has no Anthropic-family model enum', () => {
  it('does NOT type model as a literal union of sonnet/opus/haiku', () => {
    expect(existsSync(TASKTOOL)).toBe(true);
    const content = readFileSync(TASKTOOL, 'utf8');

    // Match `model?: 'sonnet' | 'opus' | 'haiku'` and reorderings.
    // Allow whitespace + bar separators in any order.
    const literalUnionRe = /model\?\s*:\s*['"](?:sonnet|opus|haiku)['"](?:\s*\|\s*['"](?:sonnet|opus|haiku)['"])+/;
    expect(
      literalUnionRe.test(content),
      'TaskTool.ts must NOT type the `model` field as a literal union of ' +
        'sonnet/opus/haiku. That biases the LLM to dispatch sub-agents with ' +
        'Anthropic family names regardless of which providers are deployed. ' +
        'Use `model?: string` instead and let the orchestrator resolve.',
    ).toBe(false);
  });

  it('does NOT include sonnet/opus/haiku in the JSON-schema enum', () => {
    const content = readFileSync(TASKTOOL, 'utf8');

    // Match `enum: [..., 'sonnet', ...]` (or opus/haiku) inside any
    // JSON schema declaration in the file.
    const schemaEnumRe = /\benum\s*:\s*\[[^\]]*['"](?:sonnet|opus|haiku)['"]/;
    expect(
      schemaEnumRe.test(content),
      'TaskTool.ts must NOT declare a JSON-schema enum containing ' +
        'sonnet/opus/haiku for the `model` field. The schema is shipped to ' +
        'every LLM that reads the Task tool — listing those values trains ' +
        'the LLM to dispatch with `model: "sonnet"` even when no Anthropic ' +
        'provider exists on the cluster.',
    ).toBe(false);
  });
});
