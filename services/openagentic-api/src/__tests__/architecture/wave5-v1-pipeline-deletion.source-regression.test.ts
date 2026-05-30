/**
 * Wave 5 deletion gate (chatmode-ux-mock-parity Phase 1 task 1.21).
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §142-150 (5 RIP
 * files), §192 (deletion in same commit batch), §289-302 (acceptance check).
 *
 * After Wave 5:
 *   - V1 ChatPipeline.ts is GONE (deleted, not stub-kept).
 *   - The 4 sibling RIP files (agents.stage / delegationGating /
 *     response.artifactStrip / ArtifactIntentGate) stay gone.
 *   - PromptComposerService keyword-scoring loop (`userIntent`,
 *     `userIntentMatched`, `domainModulesScored`, `domainModulesSelected`)
 *     is removed from the production code path.
 *   - V1 ChatPipeline test files are gone.
 *   - The umbrella arch grep test (no-regex-intent-routing) is 27/27 GREEN
 *     (mcp.stage ESSENTIAL_TYPED_TOOLS comment is gone or exempt).
 *
 * Production importers must not pull the V1 module names; this gate keeps
 * the deletion permanent.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const API_SRC = join(__dirname, '../..');

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
    try { stat = statSync(full); } catch { continue; }
    if (stat.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'build') continue;
      out.push(...collectTs(full));
    } else if (stat.isFile() && (entry.endsWith('.ts') || entry.endsWith('.tsx'))) {
      out.push(full);
    }
  }
  return out;
}

describe('Wave 5 deletion gate — V1 chat pipeline files are gone', () => {
  it('routes/chat/pipeline/ChatPipeline.ts no longer exists', () => {
    const path = join(API_SRC, 'routes/chat/pipeline/ChatPipeline.ts');
    expect(existsSync(path)).toBe(false);
  });

  it('routes/chat/pipeline/agents.stage.ts no longer exists', () => {
    const path = join(API_SRC, 'routes/chat/pipeline/agents.stage.ts');
    expect(existsSync(path)).toBe(false);
  });

  it('routes/chat/pipeline/delegationGating.ts no longer exists', () => {
    const path = join(API_SRC, 'routes/chat/pipeline/delegationGating.ts');
    expect(existsSync(path)).toBe(false);
  });

  it('routes/chat/pipeline/response.artifactStrip.ts no longer exists', () => {
    const path = join(API_SRC, 'routes/chat/pipeline/response.artifactStrip.ts');
    expect(existsSync(path)).toBe(false);
  });

  it('services/ArtifactIntentGate.ts no longer exists', () => {
    const path = join(API_SRC, 'services/ArtifactIntentGate.ts');
    expect(existsSync(path)).toBe(false);
  });

  it('no production .ts file imports the deleted V1 ChatPipeline', () => {
    const files = collectTs(API_SRC);
    const offenders: string[] = [];
    for (const filePath of files) {
      const rel = relative(join(API_SRC, '..'), filePath);
      if (rel === 'src/__tests__/architecture/wave5-v1-pipeline-deletion.source-regression.test.ts') continue;
      // Allow comment-only references in V2 surface files (they document the rip).
      let content: string;
      try { content = readFileSync(filePath, 'utf8'); } catch { continue; }
      // The arch-grep ban is on actual `import` statements — comments are fine.
      const importRe = /^\s*import\s+\{[^}]*\bChatPipeline\b[^}]*\}\s+from\s+['"][^'"]*pipeline\/ChatPipeline\.js['"]/m;
      if (importRe.test(content)) {
        offenders.push(`${rel}`);
      }
    }
    if (offenders.length > 0) {
      expect.fail(`Files still import the deleted V1 ChatPipeline:\n  ${offenders.join('\n  ')}`);
    }
  });

  it('PromptComposer.ts keyword-scoring identifiers are removed from production code', () => {
    // PromptComposer is the V1 keyword scorer; the V2 path uses
    // SystemPromptComposer.composeStatic(). The DB-backed module storage
    // stays (ModuleStorage / ModuleSeeder); only the scoring loop dies.
    // After Wave 5, the four scoring identifiers must NOT appear in the
    // production composer file.
    const composerPath = join(API_SRC, 'services/prompt/PromptComposer.ts');
    if (!existsSync(composerPath)) {
      // Whole file deleted is also acceptable.
      return;
    }
    const content = readFileSync(composerPath, 'utf8');
    expect(content).not.toMatch(/\buserIntent\b/);
    expect(content).not.toMatch(/\buserIntentMatched\b/);
    expect(content).not.toMatch(/\bdomainModulesScored\b/);
    expect(content).not.toMatch(/\bdomainModulesSelected\b/);
  });
});

/**
 * 2026-05-05 — V1 chat pipeline rip (full inventory).
 *
 * Plan: docs/research/2026-05-05-v1-chat-pipeline-rip-plan.md.
 *
 * `routes/chat/pipeline/chat/runChat.ts` is the sole chat path on
 * `/api/chat/stream`; V1 imports zero pipeline-chat symbols and is now
 * deleted entirely. This sweep extends the Wave 5 gate to cover every
 * V1 stage, helper, type, schema, test, plus the dead admin-config
 * triad (`PipelineConfigService` + `routes/admin/pipeline-config.ts`)
 * and the unused `ChatContext = PipelineContext` alias. Reintroducing
 * any of these without an explicit architectural decision must trip
 * this guard.
 */
describe('V1 chat pipeline rip — full inventory deletion gate (2026-05-05)', () => {
  const RIP_FILES = [
    // V1 stages
    'routes/chat/pipeline/auth.stage.ts',
    'routes/chat/pipeline/completion-simple.stage.ts',
    'routes/chat/pipeline/dlp-scan.stage.ts',
    'routes/chat/pipeline/memory.stage.ts',
    'routes/chat/pipeline/message-preparation.stage.ts',
    'routes/chat/pipeline/meta-tools.stage.ts',
    'routes/chat/pipeline/multi-model.stage.ts',
    'routes/chat/pipeline/rag.stage.ts',
    'routes/chat/pipeline/response.stage.ts',
    'routes/chat/pipeline/tool.stage.ts',
    'routes/chat/pipeline/validation.stage.ts',
    // V1 helpers / types / schemas
    'routes/chat/pipeline/tool-execution.helper.ts',
    'routes/chat/pipeline/tool-router.helper.ts',
    'routes/chat/pipeline/code-execution.helper.ts',
    'routes/chat/pipeline/synth-execution.helper.ts',
    'routes/chat/pipeline/error-handling.helper.ts',
    'routes/chat/pipeline/scope-enforcement.helper.ts',
    'routes/chat/pipeline/image-intent.helper.ts',
    'routes/chat/pipeline/imageFormatNormalizer.ts',
    'routes/chat/pipeline/content-safety.helper.ts',
    'routes/chat/pipeline/pipeline.types.ts',
    'routes/chat/pipeline/pipeline-config.schema.ts',
    'routes/chat/pipeline/tool-progress-tracker.ts',
    'routes/chat/pipeline/image-gen-tool.ts',
    'routes/chat/pipeline/subagent-result-routing.ts',
    'routes/chat/pipeline/stripMcpToolResultProse.ts',
    'routes/chat/pipeline/response.stripArtifactProseTokens.ts',
    'routes/chat/pipeline/completeness-gate.ts',
    // Admin-config triad (dead UI for dead stages)
    'services/PipelineConfigService.ts',
    'routes/admin/pipeline-config.ts',
  ];

  it.each(RIP_FILES)('%s no longer exists', (rel) => {
    expect(existsSync(join(API_SRC, rel))).toBe(false);
  });

  it('no production .ts file imports anything from routes/chat/pipeline/ (V1)', () => {
    // `pipeline/chat/` paths and the architecture-test directory are
    // exempt; everything else must be clean. Catches both
    // `from '../pipeline/foo.js'` and bare-name re-exports.
    const files = collectTs(API_SRC);
    const offenders: string[] = [];
    // Anchor on routes/chat/pipeline/ specifically — V1's V/V2/V3 lived
    // here. The unrelated global services/openagentic-api/src/pipeline/
    // directory (HookRunner, built-in-hooks) is a different module and
    // must remain importable.
    const importRe = /from\s+['"][^'"]*routes\/chat\/pipeline\/(?!chat\/)[^'"]+['"]/;
    for (const filePath of files) {
      const rel = relative(join(API_SRC, '..'), filePath);
      if (rel.includes('/__tests__/architecture/')) continue;
      if (rel.includes('/pipeline/chat/')) continue;
      let content: string;
      try { content = readFileSync(filePath, 'utf8'); } catch { continue; }
      if (importRe.test(content)) offenders.push(rel);
    }
    if (offenders.length > 0) {
      throw new Error(
        `Production files still import V1 pipeline modules:\n  ${offenders.join('\n  ')}\n\n` +
        `V1 was ripped 2026-05-05; the chat path lives under routes/chat/pipeline/chat/.`,
      );
    }
  });

  it('chat.types.ts no longer aliases ChatContext = PipelineContext', () => {
    const src = readFileSync(
      join(API_SRC, 'routes/chat/interfaces/chat.types.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/\bPipelineContext\b/);
    expect(src).not.toMatch(/\btype\s+ChatContext\s*=/);
  });
});
