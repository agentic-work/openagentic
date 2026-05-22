/**
 * BuiltInAgentRegistry — markdown-driven sub-agent loader for the chatmode
 * `Task` tool.
 *
 * Mirrors Anthropic's built-in agents directory at
 * `/home/trent/anthropic/src/tools/AgentTool/built-in/`. Each `.md` file
 * under `services/openagentic-api/src/agents/built-in/` carries:
 *
 *   ---
 *   name: <Title Case Name>
 *   description: |
 *     <encyclopedia-article-style ≥150 chars: USE WHEN / DO NOT USE /
 *     RETURNS / EXAMPLE>
 *   tools:
 *     - <tool_name_or_glob>
 *   ---
 *
 * NO `model:` field — CLAUDE.md no-hardcoded-models rule. The orchestrator
 * resolves the model from the DB tier registry at dispatch time so the
 * platform stays portable across providers. The loader rejects any legacy
 * `model:` line at boot.
 *
 *   # <Name>
 *   <body — the agent's own system prompt, ≥400 chars>
 *
 * Rationale: an admin / on-call human can edit a sub-agent prompt without a
 * redeploy; the loader picks up the new content on next process boot. NO
 * regex routing, NO enum gate — the model picks the agent by its description
 * (Anthropic's tool-writing rubric).
 *
 * The loader produces `BuiltInAgentRegistryEntry` which is structurally
 * compatible with `AgentRegistryEntry` from `TaskTool.ts` (the Task-tool
 * description-builder consumes the result directly via duck typing).
 *
 * NOTE: a sibling file `AgentRegistry.ts` exists in this directory — it is
 * the legacy DB-backed agent observability service. We deliberately did NOT
 * extend it: that file is 1,800+ lines and concerned with metrics, model-
 * config defaults, and personas. The chatmode markdown registry is a fresh,
 * focused concern, kept separate to avoid cross-cutting churn. Both can
 * coexist: the markdown loader feeds the chatmode `Task` tool; the DB
 * registry feeds /admin observability.
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §82-87, §177-183,
 *       §215-220.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BuiltInAgentRegistryEntry {
  /** Slug — equal to the markdown filename without `.md`, lowercase. */
  agent_type: string;
  /** Title-case display name from frontmatter `name`. */
  display_name: string;
  /** Encyclopedia-article description (≥150 chars). */
  description: string;
  /** Tool whitelist — exact names or glob patterns. */
  tools: string[];
  /** The system prompt body for this sub-agent (≥400 chars). */
  body: string;
}

// ---------------------------------------------------------------------------
// Canonical slug list — locked alphabetical order. The plan §217 picks this
// set; the test asserts `loadBuiltInAgents()` returns exactly these.
// ---------------------------------------------------------------------------

export const BUILT_IN_AGENT_SLUGS = Object.freeze([
  'artifact-creation',
  'cloud-operations',
  'code-execution',
  'data-query',
  'planning',
  'reasoning',
  'synthesis',
  'validation',
] as const);

export type BuiltInAgentSlug = (typeof BUILT_IN_AGENT_SLUGS)[number];

// ---------------------------------------------------------------------------
// Default directory resolution
// ---------------------------------------------------------------------------

function defaultBuiltInDir(): string {
  // ESM-friendly __dirname: this file lives at
  //   services/openagentic-api/src/services/BuiltInAgentRegistry.ts
  // Built-ins live at
  //   services/openagentic-api/src/agents/built-in/
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', 'agents', 'built-in');
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
//
// We deliberately avoid pulling in `gray-matter` or `js-yaml` — neither is in
// the api's package.json today, and the frontmatter schema is small and
// fixed. The parser supports:
//   - simple `key: value` lines
//   - block-scalar `key: |` followed by indented continuation lines
//   - sequence `key:` followed by `  - item` lines
// That covers every shape our 8 built-ins need. If we grow into something
// richer (anchors, flow style, multi-doc) we replace this with `js-yaml`.
// ---------------------------------------------------------------------------

interface RawFrontmatter {
  name?: string;
  description?: string;
  tools?: string[];
  model?: string;
}

function splitFrontmatter(source: string, fileName: string): { fm: string; body: string } {
  if (!source.startsWith('---')) {
    throw new Error(
      `[BuiltInAgentRegistry] ${fileName}: expected frontmatter '---' at file start`,
    );
  }
  // Skip the first '---' line.
  const afterOpen = source.replace(/^---\r?\n/, '');
  const closeIdx = afterOpen.search(/^---\s*$/m);
  if (closeIdx === -1) {
    throw new Error(
      `[BuiltInAgentRegistry] ${fileName}: frontmatter missing closing '---' fence`,
    );
  }
  const fm = afterOpen.slice(0, closeIdx);
  // Skip the closing '---' + its trailing newline.
  const rest = afterOpen.slice(closeIdx).replace(/^---\s*\r?\n?/, '');
  return { fm, body: rest };
}

function parseFrontmatter(fmText: string, fileName: string): RawFrontmatter {
  const out: RawFrontmatter = {};
  const lines = fmText.split(/\r?\n/);

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line || /^\s*$/.test(line) || /^\s*#/.test(line)) {
      i++;
      continue;
    }
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/);
    if (!m) {
      throw new Error(
        `[BuiltInAgentRegistry] ${fileName}: malformed frontmatter line: ${JSON.stringify(line)}`,
      );
    }
    const key = m[1];
    const value = m[2];

    if (value === '|' || value === '|-' || value === '|+') {
      // Block scalar — collect indented continuation lines.
      i++;
      const collected: string[] = [];
      let baseIndent = -1;
      while (i < lines.length) {
        const cont = lines[i];
        if (cont === '' && i + 1 < lines.length && /^\s/.test(lines[i + 1] ?? '')) {
          collected.push('');
          i++;
          continue;
        }
        const indentMatch = cont.match(/^(\s+)(.*)$/);
        if (!indentMatch) break;
        if (baseIndent === -1) baseIndent = indentMatch[1].length;
        collected.push(cont.slice(baseIndent));
        i++;
      }
      (out as any)[key] = collected.join('\n').trim();
      continue;
    }

    if (value === '' || value === '[]') {
      // Sequence-or-empty.
      if (value === '[]') {
        (out as any)[key] = [];
        i++;
        continue;
      }
      // Look ahead for `  - item` lines.
      const items: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        const seqMatch = next.match(/^\s+-\s+(.+?)\s*$/);
        if (!seqMatch) break;
        let item = seqMatch[1];
        // Strip surrounding quotes if present.
        if ((item.startsWith('"') && item.endsWith('"')) || (item.startsWith("'") && item.endsWith("'"))) {
          item = item.slice(1, -1);
        }
        items.push(item);
        i++;
      }
      (out as any)[key] = items;
      continue;
    }

    // Plain scalar — strip optional surrounding quotes.
    let scalar = value.trim();
    if ((scalar.startsWith('"') && scalar.endsWith('"')) || (scalar.startsWith("'") && scalar.endsWith("'"))) {
      scalar = scalar.slice(1, -1);
    }
    (out as any)[key] = scalar;
    i++;
  }

  return out;
}

function validateFrontmatter(
  raw: RawFrontmatter,
  fileName: string,
): { name: string; description: string; tools: string[] } {
  const missing: string[] = [];
  if (!raw.name || typeof raw.name !== 'string') missing.push('name');
  if (!raw.description || typeof raw.description !== 'string') missing.push('description');
  if (!Array.isArray(raw.tools)) missing.push('tools');
  if (missing.length > 0) {
    throw new Error(
      `[BuiltInAgentRegistry] ${fileName}: missing required frontmatter field(s): ${missing.join(', ')}`,
    );
  }
  // CLAUDE.md no-hardcoded-models rule: agent files MUST NOT pin a model
  // literal. The orchestrator resolves the model from the DB tier registry
  // at dispatch time. Reject any legacy `model: <literal>` field rather
  // than silently ignore it — fail-fast catches forgotten copies.
  if (raw.model !== undefined) {
    throw new Error(
      `[BuiltInAgentRegistry] ${fileName}: 'model' frontmatter field is forbidden — strip it. Tier preference belongs in the DB tier resolver, not the agent file.`,
    );
  }
  return {
    name: raw.name!,
    description: raw.description!,
    tools: raw.tools!,
  };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Read every `.md` file under `dir` (default = built-in agents dir), parse
 * its frontmatter + body, and return the entries in alphabetical
 * `agent_type` order. Throws a clear, file-scoped error on any malformed
 * frontmatter — the loader is fail-fast at process boot.
 */
export async function loadBuiltInAgents(
  dir: string = defaultBuiltInDir(),
): Promise<BuiltInAgentRegistryEntry[]> {
  const files = (await fs.promises.readdir(dir))
    .filter(f => f.endsWith('.md'))
    .sort();

  const entries: BuiltInAgentRegistryEntry[] = [];
  for (const fileName of files) {
    const fullPath = path.join(dir, fileName);
    const source = await fs.promises.readFile(fullPath, 'utf-8');
    const { fm, body } = splitFrontmatter(source, fileName);
    const raw = parseFrontmatter(fm, fileName);
    const validated = validateFrontmatter(raw, fileName);
    const slug = fileName.replace(/\.md$/, '').toLowerCase();
    entries.push({
      agent_type: slug,
      display_name: validated.name,
      description: validated.description,
      tools: validated.tools,
      body: body.trim(),
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Process-lifetime cache
// ---------------------------------------------------------------------------

let cached: BuiltInAgentRegistryEntry[] | null = null;

/**
 * Load + cache the built-in agents. Called once at api startup. Subsequent
 * calls are a no-op (idempotent); pass `dir` to override (used in tests).
 */
export async function initializeAgentRegistry(dir?: string): Promise<void> {
  cached = await loadBuiltInAgents(dir);
}

/**
 * Synchronous accessor for the cached registry. Throws if
 * `initializeAgentRegistry()` has not been called yet — prevents accidental
 * stale-empty reads at startup.
 */
export function getBuiltInAgents(): BuiltInAgentRegistryEntry[] {
  if (cached === null) {
    throw new Error(
      '[BuiltInAgentRegistry] not initialized — call initializeAgentRegistry() at api startup before reading the registry.',
    );
  }
  return cached;
}

/**
 * Test-only: reset the cache so a fresh `initializeAgentRegistry()` run
 * picks up new directory contents. NEVER call this from prod code.
 */
export function resetBuiltInAgentRegistry(): void {
  cached = null;
}
