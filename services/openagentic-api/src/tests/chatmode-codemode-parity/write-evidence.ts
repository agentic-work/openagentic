/**
 * Evidence-bundle writer.
 *
 * Runs the parity harness for every category and emits three artifacts:
 *   1. streams-samples/*.ndjson — one chat + codemode stream sample per class.
 *   2. parity-matrix.md — categorical pass/fail table.
 *   3. live-gaps.md — the discovered parity gaps logged as follow-up tasks.
 *
 * Run with:
 *   cd services/openagentic-api && \
 *   npx tsx src/tests/chatmode-codemode-parity/write-evidence.ts
 *
 * Output goes to docs/releases/0.6.6-evidence/ccr-parity/ at the repo root.
 * This script doesn't pull in vitest so it's safe to run in isolation.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runParity, type ParityScenario } from './parity-harness.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// services/openagentic-api/src/tests/chatmode-codemode-parity/ → repo root
// depth: chatmode-codemode-parity → tests → src → openagentic-api → services → agentic (5 up)
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const EVIDENCE_DIR = resolve(REPO_ROOT, 'docs', 'releases', '0.6.6-evidence', 'ccr-parity');
const SAMPLES_DIR = resolve(EVIDENCE_DIR, 'streams-samples');

const CATEGORIES: Array<{
  id: string;
  title: string;
  scenarios: ParityScenario[];
  expectGap: boolean;
}> = [
  {
    id: 'tools',
    title: 'MCP Tools',
    expectGap: false,
    scenarios: [
      {
        name: 'k8s_get_pods',
        userPrompt: 'List pods in agentic-dev',
        availableTools: ['k8s_get_pods'],
        script: [
          {
            kind: 'tool_call',
            toolName: 'k8s_get_pods',
            input: { namespace: 'agentic-dev' },
            toolId: 'fixed-id-1',
          },
          {
            kind: 'tool_result',
            toolName: 'k8s_get_pods',
            result: { pods: [{ name: 'openagentic-api-abc', status: 'Running' }] },
            toolId: 'fixed-id-1',
          },
          { kind: 'assistant_text', text: 'Pods listed.' },
        ],
      },
      {
        name: 'azure_resource_graph_query',
        userPrompt: 'Audit Azure VMs',
        availableTools: ['azure_resource_graph_query'],
        script: [
          {
            kind: 'tool_call',
            toolName: 'azure_resource_graph_query',
            input: { query: "Resources | where type =~ 'microsoft.compute/virtualmachines'" },
            toolId: 'fixed-id-2',
          },
          {
            kind: 'tool_result',
            toolName: 'azure_resource_graph_query',
            result: { count: 2 },
            toolId: 'fixed-id-2',
          },
        ],
      },
      {
        name: 'docs_search',
        userPrompt: 'Search docs',
        availableTools: ['docs_search'],
        script: [
          {
            kind: 'tool_call',
            toolName: 'docs_search',
            input: { query: 'NDJSON contract' },
            toolId: 'fixed-id-3',
          },
          {
            kind: 'tool_result',
            toolName: 'docs_search',
            result: { hits: [{ title: 'streaming-contract.md', score: 0.94 }] },
            toolId: 'fixed-id-3',
          },
        ],
      },
    ],
  },
  {
    id: 'subagent',
    title: 'Sub-agent (delegate_to_agents)',
    expectGap: true,
    scenarios: [
      {
        name: 'cloud_ops_audit',
        userPrompt: "I'm Bob. Audit our Azure subs.",
        availableTools: ['delegate_to_agents'],
        script: [
          {
            kind: 'subagent_spawn',
            agentName: 'cloud_operations',
            prompt: 'Find idle VMs',
          },
          { kind: 'subagent_result', agentName: 'cloud_operations', result: { summary: '3 VMs' } },
        ],
      },
    ],
  },
  {
    id: 'skills',
    title: 'Skills (superpowers:*, synth, etc.)',
    expectGap: true,
    scenarios: [
      {
        name: 'brainstorming',
        userPrompt: 'Brainstorm features',
        script: [
          {
            kind: 'skill_activation',
            skillName: 'superpowers:brainstorming',
            prompt: '5 ideas',
          },
        ],
      },
      {
        name: 'synth',
        userPrompt: 'Use synth',
        script: [
          { kind: 'skill_activation', skillName: 'synth', prompt: 'generate tool' },
        ],
      },
    ],
  },
  {
    id: 'plugins',
    title: 'Plugins (claude-plugins-official:*)',
    expectGap: true,
    scenarios: [
      {
        name: 'playwright',
        userPrompt: 'Load playwright',
        script: [
          { kind: 'plugin_load', pluginName: 'claude-plugins-official:playwright' },
        ],
      },
      {
        name: 'figma',
        userPrompt: 'Load figma',
        script: [{ kind: 'plugin_load', pluginName: 'claude-plugins-official:figma' }],
      },
    ],
  },
  {
    id: 'artifacts',
    title: 'Artifacts (markdown, mermaid, code)',
    expectGap: true,
    scenarios: [
      {
        name: 'markdown_table',
        userPrompt: 'Produce a markdown table',
        script: [
          {
            kind: 'artifact',
            artifactType: 'markdown',
            content: '# Audit\n| X | Y |\n|---|---|\n| 1 | 2 |\n',
          },
        ],
      },
      {
        name: 'mermaid_sequence',
        userPrompt: 'Produce a mermaid diagram',
        script: [
          {
            kind: 'artifact',
            artifactType: 'mermaid',
            content: 'sequenceDiagram\n  UI->>API: /stream\n  API-->>UI: NDJSON\n',
          },
        ],
      },
      {
        name: 'code_block',
        userPrompt: 'Produce a code block',
        script: [
          {
            kind: 'artifact',
            artifactType: 'code',
            content: '```ts\nexport const x = 1;\n```',
          },
        ],
      },
    ],
  },
];

function main(): void {
  mkdirSync(SAMPLES_DIR, { recursive: true });

  const matrixRows: Array<{
    category: string;
    scenario: string;
    chatFrames: number;
    codemodeFrames: number;
    parity: 'PASS' | 'GAP';
    divergences: number;
  }> = [];

  const gapLog: Array<{
    category: string;
    scenario: string;
    divergences: Array<Record<string, unknown>>;
  }> = [];

  for (const cat of CATEGORIES) {
    for (const scenario of cat.scenarios) {
      const run = runParity(scenario);
      matrixRows.push({
        category: cat.title,
        scenario: scenario.name,
        chatFrames: run.chat.frames.length,
        codemodeFrames: run.codemode.frames.length,
        parity: run.diff.ok ? 'PASS' : 'GAP',
        divergences: run.diff.divergences.length,
      });
      if (!run.diff.ok) {
        gapLog.push({
          category: cat.title,
          scenario: scenario.name,
          divergences: run.diff.divergences as any,
        });
      }

      // Write three samples per category (or fewer if category has less).
      const samplePath = resolve(SAMPLES_DIR, `${cat.id}__${scenario.name}`);
      writeFileSync(`${samplePath}__chat.ndjson`, run.chat.frames.join('\n') + '\n', 'utf8');
      writeFileSync(
        `${samplePath}__codemode.ndjson`,
        run.codemode.frames.join('\n') + '\n',
        'utf8',
      );
    }
  }

  // parity-matrix.md
  const matrixLines: string[] = [
    '# Chat ↔ Codemode Parity Matrix',
    '',
    'Generated by `services/openagentic-api/src/tests/chatmode-codemode-parity/write-evidence.ts`.',
    '',
    '**Masked fields:** `session_id, _seq, _ts, _runId, _agentId, messageId, request_id, uuid, timestamp, startedAt, endedAt, duration_ms, id, tool_use_id, tool_call_id`.',
    '',
    '**Normalization:** Both surfaces are lifted into a shared `NormalizedEvent` vocabulary (prompt, assistant_text, tool_call, tool_result, subagent_spawn/_result, skill_activation, plugin_load, artifact, lifecycle). The diff engine compares the sequence pairwise after mask.',
    '',
    '| Category | Scenario | Chat frames | Codemode frames | Parity | Divergences |',
    '|----------|----------|-------------|------------------|--------|-------------|',
    ...matrixRows.map(
      r =>
        `| ${r.category} | ${r.scenario} | ${r.chatFrames} | ${r.codemodeFrames} | ${r.parity} | ${r.divergences} |`,
    ),
    '',
    '## Summary',
    '',
    `- **Scenarios run:** ${matrixRows.length}`,
    `- **Parity PASS:** ${matrixRows.filter(r => r.parity === 'PASS').length}`,
    `- **Parity GAP:** ${matrixRows.filter(r => r.parity === 'GAP').length}`,
    '',
    'See `live-gaps.md` for the enumerated follow-up tasks to close the gaps.',
    '',
  ];
  writeFileSync(resolve(EVIDENCE_DIR, 'parity-matrix.md'), matrixLines.join('\n'), 'utf8');

  // live-gaps.md
  const gapLines: string[] = [
    '# Chat ↔ Codemode Parity — Live Gaps',
    '',
    'Every gap below is a concrete follow-up task. When a gap is closed:',
    '',
    '1. Flip the corresponding test in `src/tests/chatmode-codemode-parity/` from `expect(diff.ok).toBe(false)` to `.toBe(true)`.',
    '2. Remove the gap entry from this file.',
    '3. Re-run `write-evidence.ts` to regenerate `parity-matrix.md`.',
    '',
  ];

  const gapsByCategory = new Map<string, typeof gapLog>();
  for (const g of gapLog) {
    if (!gapsByCategory.has(g.category)) gapsByCategory.set(g.category, []);
    gapsByCategory.get(g.category)!.push(g);
  }

  let gapId = 1;
  for (const [cat, gaps] of gapsByCategory) {
    gapLines.push(`## Category: ${cat}`, '');
    for (const g of gaps) {
      gapLines.push(`### Gap #${gapId++}: ${cat} — ${g.scenario}`, '');
      gapLines.push('**Divergences:**', '', '```json');
      gapLines.push(JSON.stringify(g.divergences, null, 2));
      gapLines.push('```', '');
    }
  }

  writeFileSync(resolve(EVIDENCE_DIR, 'live-gaps.md'), gapLines.join('\n'), 'utf8');

  console.log(`Wrote evidence bundle to ${EVIDENCE_DIR}`);
  console.log(
    `  - ${matrixRows.length} scenarios (${matrixRows.filter(r => r.parity === 'PASS').length} PASS, ${matrixRows.filter(r => r.parity === 'GAP').length} GAP)`,
  );
  console.log(`  - ${matrixRows.length * 2} stream samples under streams-samples/`);
  console.log(`  - parity-matrix.md + live-gaps.md`);
}

main();
