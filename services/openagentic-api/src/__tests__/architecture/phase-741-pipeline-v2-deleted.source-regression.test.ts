/**
 * Phase 741 / B-vrip step 6 — `routes/chat/pipeline/v2/` directory DELETED.
 *
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md
 *       step 6 ("Delete pipeline/v2/ entirely").
 *
 * History:
 *  - B-vrip step 3 (earlier): renamed pipeline/v3/ → pipeline/chat/.
 *  - B-vrip step 5: V2/V3 strangler dispatch removed from stream.handler.ts.
 *  - Phase E.8.g+h: SubagentOrchestrator deleted; chatLoopRecursor is the
 *    in-process sub-agent primitive.
 *  - #741 (this rip): the entire `pipeline/v2/` directory is gone. The
 *    live surface (types `RunChatV2Input` / `RunChatV2Deps` /
 *    `ToolRankerLike` / `RouterTuningLike`, `buildUserMessageContent`,
 *    `dispatchChatToolCall`, `ChatPipelineDeps`, etc.) was ported to
 *    `pipeline/chat/`. `extractAttachmentText.ts` moved next to its
 *    only caller in `pipeline/chat/`.
 *
 * Gate 1: directory `routes/chat/pipeline/v2/` does not exist on disk.
 * Gate 2: no .ts/.tsx file in production source mentions `pipeline/v2`,
 *         `runChatV2Pipeline`, `ChatPipelineV2`, `runChatTurnV2`, or
 *         imports `../v2/...`. Walks all production source (skips
 *         __tests__, node_modules, dist, build).
 *
 * Stale comments left in service modules (BrowserSandboxExecTool.ts,
 * ToolSearchTool.ts, attachmentValidator.ts, etc.) are rewritten as part
 * of the same rip so the architecture gate stays GREEN.
 */
import { describe, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_SRC = join(__dirname, '../..');
const V2_DIR = join(API_SRC, 'routes/chat/pipeline/v2');

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
      if (entry === 'node_modules' || entry === 'dist' || entry === 'build') continue;
      if (entry === '__tests__') continue;
      out.push(...collectTs(full));
    } else if (
      stat.isFile() &&
      (entry.endsWith('.ts') || entry.endsWith('.tsx')) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.test.tsx')
    ) {
      out.push(full);
    }
  }
  return out;
}

const FORBIDDEN_STRINGS = [
  'pipeline/v2',
  'runChatV2Pipeline',
  'ChatPipelineV2',
  'runChatTurnV2',
];

// Files allowed to mention v2-themed words for historical / arch-test reasons.
// EMPTY after #741 — every production .ts is rewritten in the same rip.
const ALLOWLIST = new Set<string>([]);

describe('Phase 741 / B-vrip step 6 — pipeline/v2/ deleted', () => {
  it('directory routes/chat/pipeline/v2/ does NOT exist on disk', () => {
    let exists = false;
    try {
      const stat = statSync(V2_DIR);
      exists = stat.isDirectory();
    } catch {
      exists = false;
    }
    if (exists) {
      throw new Error(
        `routes/chat/pipeline/v2/ still exists on disk. ` +
          `B-vrip step 6 / issue #741 deletes the directory entirely; ` +
          `port any live symbols into pipeline/chat/ and run ` +
          `\`git rm -r services/openagentic-api/src/routes/chat/pipeline/v2/\`.`,
      );
    }
  });

  it('no production .ts/.tsx file references the 4 forbidden v2 symbols/paths', () => {
    const files = collectTs(API_SRC);
    const offenders: Array<{ file: string; matches: string[] }> = [];
    for (const filePath of files) {
      const rel = relative(join(API_SRC, '..'), filePath);
      if (ALLOWLIST.has(rel)) continue;
      let content: string;
      try {
        content = readFileSync(filePath, 'utf8');
      } catch {
        continue;
      }
      const hits: string[] = [];
      for (const sym of FORBIDDEN_STRINGS) {
        if (content.includes(sym)) hits.push(sym);
      }
      if (hits.length > 0) offenders.push({ file: rel, matches: hits });
    }
    if (offenders.length > 0) {
      const report = offenders
        .map((o) => `  ${o.file}: ${o.matches.join(', ')}`)
        .join('\n');
      throw new Error(
        `Forbidden v2 chat-pipeline references found in production source:\n${report}\n\n` +
          'The v2/ directory is deleted in B-vrip step 6 / issue #741. ' +
          'Either rewrite the comment/import or, if the import is legitimate, ' +
          'port the symbol into pipeline/chat/ and re-run.',
      );
    }
  });
});
