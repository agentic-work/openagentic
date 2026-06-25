/**
 * Architecture gate: wave2BuiltInDispatch must be built UNCONDITIONALLY
 * — never gated on `wave1ToolRanker` truthiness.
 *
 * Live regression captured 2026-05-01: when `ToolRankerService` init
 * threw at boot (transient redis/milvus/embeddings unavailability),
 * the chat-route plugin set `wave1ToolRanker = undefined`, and the
 * `wave2BuiltInDispatch` ternary then evaluated to `undefined`. That
 * `undefined` propagated into `makeRunSubagent(...)`, the dispatch's
 * `if (builtInDeps?.getBuiltInAgents && builtInDeps.listMcpProxyTools)`
 * guard failed, `expandAgentTools` was never invoked, and the
 * sub-agent's tool array was empty. The Task-tool sub-agent's LLM was
 * called with `tools: undefined` and silently ran zero tools — exactly
 * the "agents don't run tools" symptom the user reported.
 *
 * Root cause: the dispatch resolver does NOT use the ranker.
 * `expandAgentTools(agent.tools, proxyTools)` at
 * `services/buildChatV2Deps.ts:592` is a pure name-prefix expander
 * that needs only `getBuiltInAgents` + `listMcpProxyTools`. Tying its
 * presence to ranker init is wrong.
 *
 * Fix: drop the ternary. Build the dispatch object unconditionally
 * from `getBuiltInAgents` + `listMcpProxyTools`. Pass `wave1ToolRanker`
 * along (it stays optional in the type) so the ranker can be exercised
 * by the main-agent path, but the sub-agent dispatch path stays alive
 * even when ranker init failed.
 *
 * This arch-grep gate keeps the regression from sneaking back. It
 * asserts no `wave1ToolRanker ?` ternary builds wave2BuiltInDispatch
 * in chat/index.ts.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const API_SRC = join(__dirname, '../..');

const CHAT_INDEX = join(API_SRC, 'routes/chat/index.ts');

describe('Architecture: wave2BuiltInDispatch is built unconditionally (sub-agent tool resolver survives ranker init failure)', () => {
  it('chat/index.ts assembles wave2BuiltInDispatch without gating it on wave1ToolRanker', () => {
    expect(existsSync(CHAT_INDEX)).toBe(true);
    const content = readFileSync(CHAT_INDEX, 'utf8');

    // Find the wave2BuiltInDispatch declaration.
    const declRe = /const\s+wave2BuiltInDispatch\s*=\s*([\s\S]*?);(?=\n\s*const|\n\s*\/\/|\n\n)/;
    const m = content.match(declRe);
    expect(m, 'wave2BuiltInDispatch declaration must exist in chat/index.ts').not.toBeNull();
    const decl = m![1];

    // Banned: gating the entire object behind `wave1ToolRanker ?`.
    // Detects both `wave1ToolRanker ? {...} : undefined` and
    // `wave1ToolRanker ? {...} : null` regression shapes.
    const ranker_gate_pattern = /\bwave1ToolRanker\s*\?\s*\{[\s\S]*?\}\s*:\s*(undefined|null)\b/;
    expect(
      ranker_gate_pattern.test(decl),
      'wave2BuiltInDispatch must NOT be gated on wave1ToolRanker. ' +
        'When the ranker init fails (redis/milvus transient), the sub-agent ' +
        'dispatch resolver still needs getBuiltInAgents + listMcpProxyTools. ' +
        'Drop the `wave1ToolRanker ? {...} : undefined` ternary; build the ' +
        'object unconditionally.',
    ).toBe(false);

    // Required: the two name-prefix-expander handles must be present.
    expect(
      decl.includes('getBuiltInAgents'),
      'wave2BuiltInDispatch must expose getBuiltInAgents (name-prefix expander needs it)',
    ).toBe(true);
    expect(
      decl.includes('listMcpProxyTools'),
      'wave2BuiltInDispatch must expose listMcpProxyTools (name-prefix expander needs it)',
    ).toBe(true);
  });
});
