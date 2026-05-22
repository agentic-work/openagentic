/**
 * Architecture gate: no regex / keyword-based intent routing in chat pipeline.
 *
 * Plan reference: /home/trent/.claude/plans/sprightly-percolating-brook.md
 * Branch: chatmode-ux-mock-parity
 *
 * The user demonstrated the failure mode three times in a row on the same
 * prompt — "show me cloud resources and give me a sankey cost diagram for
 * the last 6 months" — because of stacked regex classifiers gating the
 * routing. The reference architecture is Claude Code's actual source at
 * /home/trent/anthropic/src: static prompt + full ~40-tool array + model
 * decides. NO regex routing, NO LLM-classifier gate, NO delegation
 * filter, NO artifact-fence post-strip.
 *
 * This test STARTS RED (regex still in tree). It goes GREEN as Phase 1
 * deletes the offending files. After GREEN, it stays as a guardrail —
 * any future regex routing reintroduction trips this test in CI.
 *
 * EXEMPT: IntentClassifierService.ts keeps an LLM classifier (not regex)
 * for FCA-floor escalation cache lookups; not a routing gate.
 *
 * EXEMPT: tool-name prefix string-match (`name.startsWith('azure_')`) is
 * a registry contract, not intent routing — kept under the same name.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const API_SRC = join(__dirname, '../..');

/**
 * Banned patterns. Each entry has:
 *   - name: human label
 *   - pattern: substring or regex token to grep for
 *   - rationale: why this is banned
 *
 * The test scans every .ts file under src/ (excluding __tests__/, the
 * classifier service kept for FCA-floor lookups, and node_modules) and
 * fails if any banned pattern is found.
 */
const BANNED_PATTERNS: Array<{
  name: string;
  needle: string | RegExp;
  rationale: string;
}> = [
  {
    name: 'isSimpleQuery() verb regex',
    needle: '/^(explain|define|describe|tell me|list|name|show|get|fetch|find|run|give me)',
    rationale:
      'Live false-positive on "show me cloud resources and give me a sankey..." — bypassed agents.stage entirely. Replaced by full-tool-array + model decides.',
  },
  {
    name: 'looksLikeRenderArtifact target regex',
    needle: 'sankey|chart|graph|diagram|flowchart|histogram|heatmap|treemap|dashboard|visualization|svg|mermaid|infographic|d3|reactflow',
    rationale:
      'Visual-target keyword match. Replaced by `RenderArtifact` tool — model picks the tool, no regex.',
  },
  {
    name: 'cloudOps multi-step detector',
    needle: 'cloudOps signal matched',
    rationale:
      'Strips direct cloud tools to force delegation. Replaced by tool descriptions that tell the model when to delegate.',
  },
  {
    name: 'codeAudit detector',
    needle: 'codeAudit',
    rationale: 'Same shape as cloudOps. Tool descriptions cover this case.',
  },
  {
    name: 'DESTRUCTIVE_VERB_REGEX',
    needle: 'DESTRUCTIVE_VERB_REGEX',
    rationale:
      'SmartModelRouter regex for FCA-floor escalation. Replaced by intent classifier + admin-tunable jsonb table.',
  },
  {
    name: 'INFRA_VERB_REGEX',
    needle: 'INFRA_VERB_REGEX',
    rationale: 'Same — SmartModelRouter regex detector.',
  },
  {
    name: 'CLOUD_LIST_ONLY_VERB_REGEX',
    needle: 'CLOUD_LIST_ONLY_VERB_REGEX',
    rationale: 'Same — SmartModelRouter regex detector.',
  },
  {
    name: 'COMPLEXITY_KEYWORDS_REGEX',
    needle: 'COMPLEXITY_KEYWORDS_REGEX',
    rationale: 'Same — SmartModelRouter complexity-bias regex.',
  },
  {
    name: 'ArtifactIntentGate VISUAL_NOUNS',
    needle: 'VISUAL_NOUNS',
    rationale:
      'Keyword set gating prompt-module injection. Replaced by static prompt sections.',
  },
  {
    name: 'ArtifactIntentGate LONG_FORM_NOUNS',
    needle: 'LONG_FORM_NOUNS',
    rationale: 'Same — ArtifactIntentGate keyword set.',
  },
  {
    name: 'RagIntentGate DOC_SEEK_RE',
    needle: 'DOC_SEEK_RE',
    rationale:
      'RAG regex gate. RAG fires on explicit user opt-in (e.g., @-mention) instead.',
  },
  {
    name: 'stripUnsolicitedArtifactFences',
    needle: 'stripUnsolicitedArtifactFences',
    rationale:
      'Post-stream artifact-fence regex stripper. Replaced by `RenderArtifact` tool — artifacts arrive as structured tool calls, not text fences.',
  },
  {
    name: 'filterRolesForDelegation',
    needle: 'filterRolesForDelegation',
    rationale:
      'Delegation-gating helper. Sub-agent roles become a tool description (`Task` tool), not an enum gate.',
  },
  {
    name: 'looksLikeRenderArtifact',
    needle: 'looksLikeRenderArtifact',
    rationale: 'See delegationGating.ts — same gate.',
  },
  {
    name: 'mcp.stage ensureEssentialAWSTools (keyword-forced injection)',
    needle: 'ensureEssentialAWSTools',
    rationale:
      'Keyword-detected forced injection of aws_s3_list / aws_ec2_list. Same shape as the deleted regex routing — picks tools server-side instead of letting the model pick from its tool array. Plan: NO semantic top-K filter / forced injection for chat.',
  },
  {
    name: 'mcp.stage ensureEssentialAzureInfraTools',
    needle: 'ensureEssentialAzureInfraTools',
    rationale: 'Same shape as ensureEssentialAWSTools — keyword-driven forced tool injection.',
  },
  {
    name: 'mcp.stage ensureEssentialAzureADTools',
    needle: 'ensureEssentialAzureADTools',
    rationale: 'Same shape — keyword-driven forced tool injection.',
  },
  {
    name: 'mcp.stage ensureEssentialK8sTools',
    needle: 'ensureEssentialK8sTools',
    rationale: 'Same shape — keyword-driven forced tool injection.',
  },
  {
    name: 'mcp.stage ensureEssentialGCPTools',
    needle: 'ensureEssentialGCPTools',
    rationale: 'Same shape — keyword-driven forced tool injection.',
  },
  {
    name: 'mcp.stage ensureEssentialGitHubTools',
    needle: 'ensureEssentialGitHubTools',
    rationale: 'Same shape — keyword-driven forced tool injection.',
  },
  {
    name: 'mcp.stage ensureEssentialObservabilityTools',
    needle: 'ensureEssentialObservabilityTools',
    rationale: 'Same shape — keyword-driven forced tool injection.',
  },
  {
    name: 'mcp.stage ensureEssentialWebTools',
    needle: 'ensureEssentialWebTools',
    rationale: 'Same shape — keyword-driven forced tool injection.',
  },
  {
    name: 'mcp.stage ESSENTIAL_TYPED_TOOLS hardcoded list',
    needle: 'ESSENTIAL_TYPED_TOOLS',
    rationale:
      'Hardcoded set of specific tool names (aws_s3_list, aws_ec2_list, etc.) that bypassed the trim ceiling. Biased the model toward listed cloud services regardless of user intent. Plan: trim by serverId/category, not specific tool names.',
  },
  {
    name: 'searchMissingEssentialTools helper',
    needle: 'searchMissingEssentialTools',
    rationale:
      'Helper for the ensureEssential* family — fetches specific tool names by string match. Dies with the family.',
  },
  {
    name: 'aws_s3_list hardcoded tool name in chat pipeline',
    needle: 'aws_s3_list',
    rationale:
      'Hardcoded specific AWS tool name forced into the tool array. The model anchored on S3 specifically when users asked about cloud resources generically. Trust the registry + LLM rerank to pick relevant tools.',
  },
  {
    name: 'aws_ec2_list hardcoded tool name in chat pipeline',
    needle: 'aws_ec2_list',
    rationale: 'Same shape as aws_s3_list — hardcoded specific tool name biasing the model.',
  },
];

const EXEMPT_FILES = new Set<string>([
  // The architecture test itself contains the patterns as needles.
  'src/__tests__/architecture/no-regex-intent-routing.source-regression.test.ts',
  // Phase E (2026-05-10) — IntentClassifierService.ts +
  // SystemPromptComposer.ts were both ripped (E.1 + E.3). Their exempt
  // entries are gone since the files no longer exist.
  // V2 surface files reference legacy names IN COMMENTS to document what
  // they replace. The code itself does not call any banned pattern.
  'src/services/RenderArtifactTool.ts',
  'src/services/TaskTool.ts',
  'src/services/RequestClarificationTool.ts',
  // CredentialScopeService maps tool NAMES to auth scopes for credential
  // injection (e.g. aws_s3_list_buckets → aws_session). That's a runtime
  // auth contract, not user-intent routing — the model never sees it.
  'src/services/CredentialScopeService.ts',
]);

function collectTs(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__' || entry === 'dist' || entry === 'build') continue;
      out.push(...collectTs(full));
    } else if (stat.isFile() && (entry.endsWith('.ts') || entry.endsWith('.tsx'))) {
      if (entry.endsWith('.test.ts') || entry.endsWith('.test.tsx')) continue;
      out.push(full);
    }
  }
  return out;
}

describe('Architecture: no regex / keyword intent routing in chat pipeline', () => {
  const allFiles = collectTs(API_SRC);

  for (const banned of BANNED_PATTERNS) {
    it(`does not contain banned pattern: ${banned.name}`, () => {
      const offenders: Array<{ path: string; line: number; preview: string }> = [];

      for (const filePath of allFiles) {
        const rel = relative(join(API_SRC, '..'), filePath);
        if (EXEMPT_FILES.has(rel)) continue;

        let content: string;
        try {
          content = readFileSync(filePath, 'utf8');
        } catch {
          continue;
        }

        const matches =
          typeof banned.needle === 'string'
            ? content.includes(banned.needle)
            : banned.needle.test(content);

        if (!matches) continue;

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const found =
            typeof banned.needle === 'string'
              ? lines[i].includes(banned.needle)
              : banned.needle.test(lines[i]);
          if (found) {
            offenders.push({
              path: rel,
              line: i + 1,
              preview: lines[i].trim().slice(0, 120),
            });
            break;
          }
        }
      }

      if (offenders.length > 0) {
        const detail = offenders
          .map(o => `  ${o.path}:${o.line}\n      ${o.preview}`)
          .join('\n');
        const msg =
          `Banned pattern "${banned.name}" still in tree.\n` +
          `Rationale: ${banned.rationale}\n\n` +
          `Found in:\n${detail}\n\n` +
          `Fix: delete the file (per plan: chatmode-ux-mock-parity branch),\n` +
          `or — if the file legitimately needs to keep the pattern — add\n` +
          `it to EXEMPT_FILES with a one-line justification comment.`;
        expect.fail(msg);
      }
    });
  }

  // Phase E.1 (2026-05-10) — IntentClassifierService.ts was ripped.
  // The legacy "IntentClassifierService is exempt and uses LLM not regex"
  // case is gone with the file. Model decides intent intrinsically now.
});
