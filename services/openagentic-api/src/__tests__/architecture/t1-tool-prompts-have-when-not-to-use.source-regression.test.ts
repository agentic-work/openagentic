/**
 * Architecture pin — every T1 meta-tool description must contain BOTH
 * a "when to use" trigger AND a "when NOT to use" negative example.
 *
 * Spec: docs/superpowers/specs/2026-05-05-tool-grounding-architecture.md §1
 *       Stage 4 — per-tool how-to prompt fragments.
 *
 * Production reference: Anthropic Claude Code at
 *   ~/anthropic/src/constants/prompts.ts:305 — "Do NOT use the BASH_TOOL_NAME
 *   to run commands when a relevant dedicated tool is provided."
 *   ~/anthropic/src/tools/<Name>/prompt.ts — every tool ships its own.
 *
 * Why this gate exists:
 *   The reliability of "model picks the right tool" comes from the
 *   QUALITY of the per-tool prompts — specifically the negative examples
 *   ("don't use this when…"), not from a separate classifier. This is
 *   the convergent finding from Anthropic Claude Code production code.
 *   Claude Code's tool-decision logic uses tool_choice=auto plus
 *   negative-example prompts, no binary classifier. We mirror that.
 *
 * What this test asserts (NOT what it embeds):
 *   For EACH of the 8 T1 meta-tools, its description text contains:
 *     1. Positive trigger language ("Use when …", "Use FIRST when …",
 *        "Call this when …", or "<tool_name> when …")
 *     2. Negative-example language ("do NOT use", "don't use", "avoid",
 *        "Use X instead", "NEVER call", or "is wrong")
 *
 * The 8 T1 meta-tools (from the master design):
 *   Task, tool_search, agent_search, compose_visual, compose_app,
 *   request_clarification, browser_sandbox_exec, memorize.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SVC_DIR = join(__dirname, '../../services');

interface ToolFile {
  /** Display name used in test output. */
  name: string;
  /** Filename relative to services/ */
  file: string;
}

const T1_TOOLS: ToolFile[] = [
  { name: 'Task',                    file: 'TaskTool.ts' },
  { name: 'tool_search',             file: 'ToolSearchTool.ts' },
  { name: 'agent_search',            file: 'AgentSearchTool.ts' },
  { name: 'compose_visual',          file: 'ComposeVisualTool.ts' },
  { name: 'compose_app',             file: 'ComposeAppTool.ts' },
  { name: 'request_clarification',   file: 'RequestClarificationTool.ts' },
  { name: 'browser_sandbox_exec',    file: 'BrowserSandboxExecTool.ts' },
  { name: 'memorize',                file: 'MemorizeTool.ts' },
];

const POSITIVE_TRIGGER_RE = /\b(?:Use\s+when|Use\s+FIRST\s+when|Call\s+this\s+when|when\s+the\s+user|use\s+this\s+(?:tool|when))/i;
const NEGATIVE_GUIDANCE_RE = /\b(?:do\s+NOT\s+use|don'?t\s+use|never\s+call|never\s+use|avoid\s+(?:calling|using)|use\s+\w+\s+instead|is\s+wrong|do\s+not\s+call|prefer\s+\w+\s+over)/i;

function readToolSource(file: string): string {
  return readFileSync(join(SVC_DIR, file), 'utf8');
}

describe('T1 meta-tools — description contains WHEN-to-use AND WHEN-NOT-to-use guidance', () => {
  for (const tool of T1_TOOLS) {
    describe(tool.name, () => {
      it(`${tool.name}: description contains positive trigger guidance ("Use when…" / "Call this when…")`, () => {
        const src = readToolSource(tool.file);
        expect(
          src,
          `Expected ${tool.file} to contain positive trigger language matching ${POSITIVE_TRIGGER_RE} — see Claude Code prompt.ts pattern`,
        ).toMatch(POSITIVE_TRIGGER_RE);
      });

      it(`${tool.name}: description contains negative-example guidance ("Do NOT use…" / "Use X instead…")`, () => {
        const src = readToolSource(tool.file);
        expect(
          src,
          `Expected ${tool.file} to contain negative-example language matching ${NEGATIVE_GUIDANCE_RE} — Claude Code prompts.ts:305 pattern. Without negative examples, the model has no signal to AVOID misuse.`,
        ).toMatch(NEGATIVE_GUIDANCE_RE);
      });
    });
  }
});
