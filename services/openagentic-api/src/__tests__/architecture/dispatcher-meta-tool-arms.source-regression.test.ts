/**
 * Architecture pin — dispatchChatToolCall.ts must keep its 12 meta-tool
 * dispatch arms aligned with the canonical meta-tool set.
 *
 * Context (Sev-1 audit 2026-05-12 finding): the base T1 catalog
 * `getAllBaseTools()` was trimmed Phase C.1 to 12 always-on primitives;
 * the legacy 6 (compose_visual, compose_app, render_artifact,
 * request_clarification, browser_sandbox_exec, memorize) became
 * tool_search-discoverable. The dispatcher arms remained for those —
 * correct behavior (the model can still emit those tool_use blocks via
 * discovery), but without a pin, a future "cleanup" PR might delete an
 * arm without realizing the discovery path still routes there. This
 * test catches that.
 *
 * Verification:
 *   1. Every meta-tool name we expect to dispatch HAS a dispatch arm.
 *   2. The dispatch arms are EXHAUSTIVE — no orphan handlers.
 *
 * Failure mode = a name-match function `isXxxTool` is imported but
 * never invoked, OR a known meta-tool has no dispatch arm.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DISPATCHER = join(
  __dirname,
  '../../routes/chat/pipeline/chat/dispatchChatToolCall.ts',
);

/**
 * Meta-tool names + their dispatcher name-match guard. Update both
 * sides together — that's the whole point of this pin.
 */
const META_TOOL_DISPATCH_CONTRACT: ReadonlyArray<{
  toolName: string;
  guard: string;
  inT1Catalog: boolean;
  discoveryRoute: 'always-on' | 'tool_search' | 'agent_search';
}> = [
  // ── Always-on T1 catalog (in getAllBaseTools) ────────────────────
  { toolName: 'Task', guard: 'isTaskTool', inT1Catalog: true, discoveryRoute: 'always-on' },
  { toolName: 'tool_search', guard: 'isToolSearchTool', inT1Catalog: true, discoveryRoute: 'always-on' },
  { toolName: 'agent_search', guard: 'isAgentSearchTool', inT1Catalog: true, discoveryRoute: 'always-on' },
  // ── Phase C.1 discoverable meta-tools (NOT in base catalog) ──────
  // The dispatcher must still route them when the model invokes via
  // tool_search-discovered surface.
  { toolName: 'compose_visual', guard: 'isComposeVisualTool', inT1Catalog: false, discoveryRoute: 'tool_search' },
  { toolName: 'compose_app', guard: 'isComposeAppTool', inT1Catalog: false, discoveryRoute: 'tool_search' },
  { toolName: 'render_artifact', guard: 'isRenderArtifactTool', inT1Catalog: false, discoveryRoute: 'tool_search' },
  { toolName: 'request_clarification', guard: 'isRequestClarificationTool', inT1Catalog: false, discoveryRoute: 'tool_search' },
  { toolName: 'memorize', guard: 'isMemorizeTool', inT1Catalog: false, discoveryRoute: 'tool_search' },
];

describe('dispatchChatToolCall.ts — meta-tool arm contract', () => {
  const src = readFileSync(DISPATCHER, 'utf8');

  it.each(META_TOOL_DISPATCH_CONTRACT)(
    'imports + invokes `$guard` for tool `$toolName` ($discoveryRoute)',
    ({ guard }) => {
      // Import line: `  isXxxTool,` inside an import block
      const importPattern = new RegExp(`\\b${guard}\\b`, 'g');
      const matches = src.match(importPattern);
      expect(
        matches?.length ?? 0,
        `${guard} should appear ≥ 2 times in dispatchChatToolCall.ts (import + invocation)`,
      ).toBeGreaterThanOrEqual(2);

      // Invocation line: `if (isXxxTool(name)) {`
      const invokePattern = new RegExp(`if\\s*\\(\\s*${guard}\\s*\\(`, 'g');
      expect(
        invokePattern.test(src),
        `${guard} should be invoked via "if (${guard}(name))" in dispatchChatToolCall.ts`,
      ).toBe(true);
    },
  );

  it('no orphan dispatch arms — every `isXxxTool` invocation is in the contract', () => {
    // Parse all `if (isXxxTool(` invocations.
    const invocations = [...src.matchAll(/if\s*\(\s*(is[A-Z]\w+Tool)\s*\(/g)].map(
      (m) => m[1],
    );
    const uniqueInvocations = [...new Set(invocations)];
    const contractGuards = META_TOOL_DISPATCH_CONTRACT.map((c) => c.guard);
    const orphans = uniqueInvocations.filter((g) => !contractGuards.includes(g));
    // Allow agent_* + memory/pattern tools (separate contract slot).
    // The strict check: any orphan that's NOT one of the explicitly
    // allowed pattern-tool / agent-control families is a regression.
    const allowedOrphanPrefixes = [
      'isAgentSendTool',
      'isAgentListTool',
      'isAgentStopTool',
      'isPatternSaveTool',
      'isPatternRecallTool',
      'isReadLargeResultTool',
      'isBrowserSandboxTool',
      'isBrowserSandboxExecTool',
    ];
    const realOrphans = orphans.filter((g) => !allowedOrphanPrefixes.includes(g));
    expect(realOrphans).toEqual([]);
  });
});
