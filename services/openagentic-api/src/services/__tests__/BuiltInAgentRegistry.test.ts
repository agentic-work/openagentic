/**
 * BuiltInAgentRegistry — TDD for the markdown-driven sub-agent loader.
 *
 * This is the agent registry the chatmode `Task` tool consumes. Markdown
 * built-ins under `services/openagentic-api/src/agents/built-in/*.md` are
 * the canonical SoT for sub-agent identities (mirrors Claude Code's
 * `/home/trent/anthropic/src/tools/AgentTool/built-in/`). Each .md file is
 * a frontmatter+body shape that the loader parses into an
 * `AgentRegistryEntry`.
 *
 * The 6-field `AgentRegistryEntry` here EXTENDS the 3-field shape declared
 * in `TaskTool.ts` (compatible — it's structural-typed and includes the
 * three required fields verbatim).
 *
 * Plan: docs/chatmode-ux-mock-parity/02-plan-canonical.md §82-87, §177-183,
 *       §215-220.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  loadBuiltInAgents,
  getBuiltInAgents,
  initializeAgentRegistry,
  resetBuiltInAgentRegistry,
  BUILT_IN_AGENT_SLUGS,
  type BuiltInAgentRegistryEntry,
} from '../BuiltInAgentRegistry.js';
import { buildTaskToolDescription } from '../TaskTool.js';

const BUILTIN_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  'agents',
  'built-in',
);

const EXPECTED_SLUGS = [
  'artifact-creation',
  'cloud-operations',
  'code-execution',
  'data-query',
  'planning',
  'reasoning',
  'synthesis',
  'validation',
] as const;

// ---------------------------------------------------------------------------
// loadBuiltInAgents — directory parsing
// ---------------------------------------------------------------------------

describe('loadBuiltInAgents', () => {
  it('reads exactly 8 markdown files from the built-in directory', async () => {
    const agents = await loadBuiltInAgents(BUILTIN_DIR);
    expect(agents).toHaveLength(8);
  });

  it('produces entries with the required fields populated (model is NOT a field — registry must not pin model literals per CLAUDE.md no-hardcoded-models rule)', async () => {
    const agents = await loadBuiltInAgents(BUILTIN_DIR);
    for (const a of agents) {
      expect(typeof a.agent_type).toBe('string');
      expect(a.agent_type.length).toBeGreaterThan(0);
      expect(typeof a.display_name).toBe('string');
      expect(a.display_name.length).toBeGreaterThan(0);
      expect(typeof a.description).toBe('string');
      expect(typeof a.body).toBe('string');
      expect(Array.isArray(a.tools)).toBe(true);
      // No model field — the orchestrator resolves the model from the DB
      // tier registry at dispatch time. Hardcoding 'sonnet'/'opus'/'haiku'
      // in agent frontmatter violates the CLAUDE.md rule and was dead
      // code (no consumer read agent.model).
      expect((a as any).model).toBeUndefined();
    }
  });

  it('every description is at least 150 characters (encyclopedia-article rubric)', async () => {
    const agents = await loadBuiltInAgents(BUILTIN_DIR);
    for (const a of agents) {
      expect(
        a.description.length,
        `${a.agent_type} description shorter than 150 chars`,
      ).toBeGreaterThanOrEqual(150);
    }
  });

  it('every body (system prompt) is at least 400 characters', async () => {
    const agents = await loadBuiltInAgents(BUILTIN_DIR);
    for (const a of agents) {
      expect(
        a.body.length,
        `${a.agent_type} body shorter than 400 chars`,
      ).toBeGreaterThanOrEqual(400);
    }
  });

  it('every description follows the USE WHEN / DO NOT USE / RETURNS / EXAMPLE rubric', async () => {
    const agents = await loadBuiltInAgents(BUILTIN_DIR);
    for (const a of agents) {
      const d = a.description;
      expect(d, `${a.agent_type} missing USE WHEN clause`).toMatch(/USE WHEN/i);
      expect(d, `${a.agent_type} missing DO NOT USE clause`).toMatch(/DO NOT USE/i);
      expect(d, `${a.agent_type} missing RETURNS clause`).toMatch(/RETURNS/i);
      expect(d, `${a.agent_type} missing EXAMPLE clause`).toMatch(/EXAMPLE/i);
    }
  });

  it('emits the canonical 8 agent_type slugs from the plan, in alphabetical order', async () => {
    const agents = await loadBuiltInAgents(BUILTIN_DIR);
    const slugs = agents.map(a => a.agent_type);
    expect(slugs).toEqual([...EXPECTED_SLUGS]);
  });

  it('exports the canonical slug list as a frozen constant', () => {
    expect(BUILT_IN_AGENT_SLUGS).toEqual([...EXPECTED_SLUGS]);
    expect(Object.isFrozen(BUILT_IN_AGENT_SLUGS)).toBe(true);
  });

  it('the agent_type slug equals the markdown filename without extension (lowercase)', async () => {
    const agents = await loadBuiltInAgents(BUILTIN_DIR);
    for (const a of agents) {
      const filePath = path.join(BUILTIN_DIR, `${a.agent_type}.md`);
      expect(
        fs.existsSync(filePath),
        `${a.agent_type}.md must exist in ${BUILTIN_DIR}`,
      ).toBe(true);
      expect(a.agent_type).toBe(a.agent_type.toLowerCase());
    }
  });

  it('NO agent .md file pins a model literal in frontmatter (CLAUDE.md no-hardcoded-models rule)', async () => {
    // Source-grep check: the parser MUST reject any frontmatter line of the
    // form `model: <literal>`. This is a hard rule — even a typed tier name
    // like `sonnet` is a model literal that breaks deployments where the DB
    // registry doesn't include Claude. Tier preference belongs in the DB
    // tier resolver, not the agent file.
    for (const slug of EXPECTED_SLUGS) {
      const filePath = path.join(BUILTIN_DIR, `${slug}.md`);
      const raw = fs.readFileSync(filePath, 'utf8');
      const fm = raw.split('---')[1] ?? '';
      expect(
        fm,
        `${slug}.md frontmatter must not contain a 'model:' line — strip it`,
      ).not.toMatch(/^\s*model:/m);
    }
  });

  it('reasoning, synthesis, and planning expose ZERO tools (pure-reasoning agents)', async () => {
    const agents = await loadBuiltInAgents(BUILTIN_DIR);
    const byType = new Map(agents.map(a => [a.agent_type, a]));
    expect(byType.get('reasoning')?.tools).toEqual([]);
    expect(byType.get('synthesis')?.tools).toEqual([]);
    expect(byType.get('planning')?.tools).toEqual([]);
  });

  it('cloud-operations exposes glob/wildcard tool entries for the cloud MCPs', async () => {
    const agents = await loadBuiltInAgents(BUILTIN_DIR);
    const byType = new Map(agents.map(a => [a.agent_type, a]));
    const cloudTools = byType.get('cloud-operations')?.tools ?? [];
    expect(cloudTools.length).toBeGreaterThan(0);
    expect(cloudTools.some(t => /^azure_/.test(t))).toBe(true);
    expect(cloudTools.some(t => /^aws_/.test(t))).toBe(true);
    expect(cloudTools.some(t => /^gcp_/.test(t))).toBe(true);
    expect(cloudTools.some(t => /^k8s_/.test(t))).toBe(true);
  });

  it('throws a clear error when frontmatter is malformed, citing the offending file', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-registry-bad-'));
    try {
      // Missing closing `---` fence
      fs.writeFileSync(
        path.join(tmp, 'broken.md'),
        '---\nname: Broken\n# No close fence here\n\n# Body\nhello',
        'utf-8',
      );
      await expect(loadBuiltInAgents(tmp)).rejects.toThrow(/broken\.md/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('throws when a required frontmatter field is missing, citing the file', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-registry-missing-'));
    try {
      // Missing `description` field (name + tools present, no model)
      fs.writeFileSync(
        path.join(tmp, 'incomplete.md'),
        '---\nname: Incomplete\ntools: []\n---\n\n# Incomplete\n\nbody',
        'utf-8',
      );
      await expect(loadBuiltInAgents(tmp)).rejects.toThrow(/incomplete\.md/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('throws when a legacy `model:` literal is present in frontmatter, citing the file (no-hardcoded-models gate)', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-registry-model-'));
    try {
      fs.writeFileSync(
        path.join(tmp, 'legacy.md'),
        '---\nname: Legacy\ndescription: long enough description that passes the parser presence check abc abc abc abc abc abc abc\ntools: []\nmodel: sonnet\n---\n\n# Legacy\n\nbody',
        'utf-8',
      );
      await expect(loadBuiltInAgents(tmp)).rejects.toThrow(/legacy\.md.*model.*forbidden/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// initializeAgentRegistry / getBuiltInAgents — process-lifetime cache
// ---------------------------------------------------------------------------

describe('getBuiltInAgents (cached accessor)', () => {
  beforeAll(() => {
    resetBuiltInAgentRegistry();
  });
  afterAll(() => {
    resetBuiltInAgentRegistry();
  });

  it('throws before initializeAgentRegistry() is called', () => {
    expect(() => getBuiltInAgents()).toThrow(/initialize/i);
  });

  it('returns the cached list after initializeAgentRegistry()', async () => {
    await initializeAgentRegistry();
    const a = getBuiltInAgents();
    const b = getBuiltInAgents();
    expect(a).toHaveLength(8);
    expect(a).toBe(b);
  });

  it('supports a custom directory override via initializeAgentRegistry(dir)', async () => {
    resetBuiltInAgentRegistry();
    await initializeAgentRegistry(BUILTIN_DIR);
    expect(getBuiltInAgents()).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// Cross-reference: feeds buildTaskToolDescription
// ---------------------------------------------------------------------------

describe('cross-reference with TaskTool.buildTaskToolDescription', () => {
  it('produces a description containing every agent_type slug verbatim', async () => {
    const agents = await loadBuiltInAgents(BUILTIN_DIR);
    const desc = await buildTaskToolDescription(agents);
    for (const a of agents) {
      expect(
        desc,
        `description missing slug ${a.agent_type}`,
      ).toContain(a.agent_type);
    }
  });

  it('the rendered description is at least 250 characters total', async () => {
    const agents = await loadBuiltInAgents(BUILTIN_DIR);
    const desc = await buildTaskToolDescription(agents);
    expect(desc.length).toBeGreaterThanOrEqual(250);
  });

  it('the rendered description contains every display_name', async () => {
    const agents = await loadBuiltInAgents(BUILTIN_DIR);
    const desc = await buildTaskToolDescription(agents);
    for (const a of agents) {
      expect(desc).toContain(a.display_name);
    }
  });
});

// ---------------------------------------------------------------------------
// Type-shape sanity (ensures BuiltInAgentRegistryEntry is structurally
// compatible with TaskTool's AgentRegistryEntry — no breakage when the
// loader's output is passed straight to buildTaskToolDescription).
// ---------------------------------------------------------------------------

describe('BuiltInAgentRegistryEntry shape', () => {
  it('is structurally compatible with TaskTool.AgentRegistryEntry (3 required fields)', async () => {
    const agents = await loadBuiltInAgents(BUILTIN_DIR);
    // We assign to a variable typed as AgentRegistryEntry-compatible to
    // catch any future accidental field rename / shape drift at compile
    // time; runtime check is the agent_type / display_name / description
    // triple being present and string.
    for (const a of agents as BuiltInAgentRegistryEntry[]) {
      expect(typeof a.agent_type).toBe('string');
      expect(typeof a.display_name).toBe('string');
      expect(typeof a.description).toBe('string');
    }
  });
});
