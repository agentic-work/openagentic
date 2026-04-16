/**
 * CodeMode Sync Service
 *
 * Fetches plugin metadata from GitHub repos and stores in SystemConfiguration.
 * Also seeds initial data from hardcoded defaults if DB is empty.
 *
 * Target repos:
 * - agentic-work/openagentic — check for plugins directory structure
 */

import { prisma } from '../utils/prisma.js';

// ---------------------------------------------------------------------------
// DB helpers — mirror the route helpers, read/write 'codemode.' prefix
// ---------------------------------------------------------------------------

async function getCodemodeConfig(key: string): Promise<any> {
  const row = await prisma.systemConfiguration.findUnique({ where: { key: `codemode.${key}` } });
  if (!row) return null;
  try { return JSON.parse(row.value as string); } catch { return row.value; }
}

async function setCodemodeConfig(key: string, value: any): Promise<void> {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  await prisma.systemConfiguration.upsert({
    where: { key: `codemode.${key}` },
    update: { value: serialized, updated_at: new Date() },
    create: { key: `codemode.${key}`, value: serialized },
  });
}

// ---------------------------------------------------------------------------
// Seed Data (duplicated from UI codemodeSeeds.ts — cannot import cross-package)
// ---------------------------------------------------------------------------

interface SeedSkill {
  id: string;
  name: string;
  description: string;
  source: string;
  tags: string[];
  enabled: boolean;
}

interface SeedMcpServer {
  id: string;
  name: string;
  description: string;
  type: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  headers?: Record<string, string>;
  env?: Record<string, string>;
  pluginSource: string;
  enabled: boolean;
}

interface SeedPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  provides: { skills: number; mcpServers: number; hooks: number };
  enabled: boolean;
  source: string;
}

interface SeedRegistry {
  name: string;
  url: string;
  official: boolean;
}

const SEED_SKILLS: SeedSkill[] = [
  // superpowers plugin (14 skills)
  { id: 'sp-brainstorming', name: 'brainstorming', description: 'Explores user intent, requirements and design before implementation. MUST use before any creative work.', source: 'superpowers', tags: ['process', 'design'], enabled: true },
  { id: 'sp-writing-plans', name: 'writing-plans', description: 'Create detailed implementation plans from specs or requirements, before touching code.', source: 'superpowers', tags: ['process', 'planning'], enabled: true },
  { id: 'sp-executing-plans', name: 'executing-plans', description: 'Execute written implementation plans in a separate session with review checkpoints.', source: 'superpowers', tags: ['process', 'execution'], enabled: true },
  { id: 'sp-test-driven-development', name: 'test-driven-development', description: 'Red-Green-Refactor TDD cycle. Use before writing implementation code.', source: 'superpowers', tags: ['process', 'testing'], enabled: true },
  { id: 'sp-systematic-debugging', name: 'systematic-debugging', description: 'Structured debugging methodology. Use when encountering any bug, test failure, or unexpected behavior.', source: 'superpowers', tags: ['process', 'debugging'], enabled: true },
  { id: 'sp-verification-before-completion', name: 'verification-before-completion', description: 'Evidence-based verification before claiming success. Run verification commands and confirm output before any success claims.', source: 'superpowers', tags: ['process', 'quality'], enabled: true },
  { id: 'sp-requesting-code-review', name: 'requesting-code-review', description: 'Request code review from subagents when completing tasks, implementing features, or before merging.', source: 'superpowers', tags: ['process', 'review'], enabled: true },
  { id: 'sp-receiving-code-review', name: 'receiving-code-review', description: 'Receive and respond to code review feedback with technical rigor, not blind agreement.', source: 'superpowers', tags: ['process', 'review'], enabled: false },
  { id: 'sp-dispatching-parallel-agents', name: 'dispatching-parallel-agents', description: 'Delegate 2+ independent tasks to parallel agents without shared state or sequential dependencies.', source: 'superpowers', tags: ['process', 'agents'], enabled: true },
  { id: 'sp-subagent-driven-development', name: 'subagent-driven-development', description: 'Execute implementation plans with per-task subagents and two-stage review.', source: 'superpowers', tags: ['process', 'agents'], enabled: true },
  { id: 'sp-using-git-worktrees', name: 'using-git-worktrees', description: 'Create isolated git worktrees for feature work. Smart directory selection and safety verification.', source: 'superpowers', tags: ['git', 'workflow'], enabled: false },
  { id: 'sp-finishing-a-development-branch', name: 'finishing-a-development-branch', description: 'Guide completion of dev work — structured options for merge, PR, or cleanup.', source: 'superpowers', tags: ['git', 'workflow'], enabled: false },
  { id: 'sp-writing-skills', name: 'writing-skills', description: 'Create and test new skills using TDD. Use when building or editing skills.', source: 'superpowers', tags: ['meta', 'skills'], enabled: false },
  { id: 'sp-using-superpowers', name: 'using-superpowers', description: 'Entry point — establishes how to find and use skills. Invoked at conversation start.', source: 'superpowers', tags: ['meta', 'core'], enabled: true },
  // claude-md-management plugin (1 skill)
  { id: 'cmd-claude-md-improver', name: 'claude-md-improver', description: 'Audit and improve CLAUDE.md files. Scans, evaluates quality, outputs report, makes targeted updates.', source: 'claude-md-management', tags: ['docs', 'maintenance'], enabled: false },
  // frontend-design plugin (1 skill)
  { id: 'fd-frontend-design', name: 'frontend-design', description: 'Create distinctive, production-grade frontend interfaces. Generates polished code avoiding generic AI aesthetics.', source: 'frontend-design', tags: ['ui', 'design'], enabled: true },
];

const SEED_MCP_SERVERS: SeedMcpServer[] = [
  { id: 'mcp-context7', name: 'context7', description: 'Upstash Context7 — fetch current library/framework documentation directly from source repos into LLM context.', type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'], pluginSource: 'context7', enabled: true },
  { id: 'mcp-playwright', name: 'playwright', description: 'Microsoft Playwright — browser automation, screenshots, form filling, E2E testing workflows.', type: 'stdio', command: 'npx', args: ['@playwright/mcp@latest'], pluginSource: 'playwright', enabled: false },
  { id: 'mcp-github', name: 'github', description: 'GitHub MCP — repos, issues, PRs, code search, actions. Requires GITHUB_PERSONAL_ACCESS_TOKEN.', type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { 'Authorization': 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}' }, pluginSource: 'github', enabled: false },
];

const SEED_PLUGINS: SeedPlugin[] = [
  { id: 'plugin-superpowers', name: 'superpowers', version: '5.0.7', description: 'Core skills library: TDD, debugging, collaboration patterns, and proven techniques.', provides: { skills: 14, mcpServers: 0, hooks: 0 }, enabled: true, source: 'marketplace' },
  { id: 'plugin-context7', name: 'context7', version: 'latest', description: 'Up-to-date library documentation lookup via Upstash Context7 MCP.', provides: { skills: 0, mcpServers: 1, hooks: 0 }, enabled: true, source: 'marketplace' },
  { id: 'plugin-playwright', name: 'playwright', version: 'latest', description: 'Browser automation and E2E testing MCP server by Microsoft.', provides: { skills: 0, mcpServers: 1, hooks: 0 }, enabled: false, source: 'marketplace' },
  { id: 'plugin-github', name: 'github', version: 'latest', description: 'GitHub integration — repos, issues, PRs, code search via MCP.', provides: { skills: 0, mcpServers: 1, hooks: 0 }, enabled: false, source: 'marketplace' },
  { id: 'plugin-frontend-design', name: 'frontend-design', version: 'latest', description: 'Create distinctive, production-grade frontend interfaces with high design quality.', provides: { skills: 1, mcpServers: 0, hooks: 0 }, enabled: true, source: 'marketplace' },
  { id: 'plugin-claude-md-management', name: 'claude-md-management', version: '1.0.0', description: 'Audit and improve CLAUDE.md files in repositories.', provides: { skills: 1, mcpServers: 0, hooks: 0 }, enabled: false, source: 'marketplace' },
  { id: 'plugin-code-review', name: 'code-review', version: 'latest', description: 'Code review plugin with confidence-based filtering.', provides: { skills: 0, mcpServers: 0, hooks: 0 }, enabled: true, source: 'marketplace' },
  { id: 'plugin-code-simplifier', name: 'code-simplifier', version: '1.0.0', description: 'Simplify and refine code for clarity, consistency, and maintainability.', provides: { skills: 0, mcpServers: 0, hooks: 0 }, enabled: true, source: 'marketplace' },
  { id: 'plugin-feature-dev', name: 'feature-dev', version: 'latest', description: 'Guided feature development with codebase understanding and architecture focus.', provides: { skills: 0, mcpServers: 0, hooks: 0 }, enabled: true, source: 'marketplace' },
  { id: 'plugin-ralph-loop', name: 'ralph-loop', version: 'latest', description: 'Ralph Loop — recurring prompt/command runner framework.', provides: { skills: 0, mcpServers: 0, hooks: 0 }, enabled: false, source: 'marketplace' },
  { id: 'plugin-security-guidance', name: 'security-guidance', version: 'latest', description: 'Security best practices and vulnerability guidance.', provides: { skills: 0, mcpServers: 0, hooks: 0 }, enabled: false, source: 'marketplace' },
  { id: 'plugin-typescript-lsp', name: 'typescript-lsp', version: 'latest', description: 'TypeScript language server integration.', provides: { skills: 0, mcpServers: 0, hooks: 0 }, enabled: false, source: 'marketplace' },
];

const SEED_REGISTRIES: SeedRegistry[] = [
  { name: 'Claude Code Official', url: 'https://github.com/agentic-work/openagentic', official: true },
];

// ---------------------------------------------------------------------------
// Seed defaults into DB if empty
// ---------------------------------------------------------------------------

export async function seedCodemodeDefaults(): Promise<void> {
  const existing = await getCodemodeConfig('skills');
  if (existing !== null) return; // Already seeded

  await Promise.all([
    setCodemodeConfig('skills', SEED_SKILLS),
    setCodemodeConfig('plugins', SEED_PLUGINS),
    setCodemodeConfig('mcp-servers', SEED_MCP_SERVERS),
    setCodemodeConfig('registries', SEED_REGISTRIES),
    setCodemodeConfig('mcp-policy', { allowManagedOnly: true }),
  ]);
}

// ---------------------------------------------------------------------------
// GitHub Sync
// ---------------------------------------------------------------------------

interface SyncResult {
  ok: boolean;
  pluginCount: number;
  skillCount: number;
  mcpCount: number;
  errors: string[];
}

/**
 * Fetch plugin metadata from GitHub repos and merge into SystemConfiguration.
 * Preserves existing enabled states for items already in DB.
 */
export async function syncFromGitHub(): Promise<SyncResult> {
  const errors: string[] = [];
  let pluginCount = 0;
  let skillCount = 0;
  let mcpCount = 0;

  const headers: Record<string, string> = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'OpenAgentic-CodeMode-Sync',
  };
  const ghToken = process.env.GITHUB_TOKEN;
  if (ghToken) {
    headers['Authorization'] = `Bearer ${ghToken}`;
  }

  // Seed defaults first if DB is empty
  await seedCodemodeDefaults();

  // Load existing data to preserve enabled states
  const existingSkills: any[] = await getCodemodeConfig('skills') ?? [];
  const existingPlugins: any[] = await getCodemodeConfig('plugins') ?? [];
  const existingMcpServers: any[] = await getCodemodeConfig('mcp-servers') ?? [];

  const enabledSkillIds = new Set(existingSkills.filter((s: any) => s.enabled).map((s: any) => s.id));
  const enabledPluginIds = new Set(existingPlugins.filter((p: any) => p.enabled).map((p: any) => p.id));
  const enabledMcpIds = new Set(existingMcpServers.filter((m: any) => m.enabled).map((m: any) => m.id));

  // --- Fetch from agentic-work/openagentic ---
  try {
    const repoBase = 'https://api.github.com/repos/agentic-work/openagentic/contents';

    // Try to list the plugins directory
    const pluginsDirRes = await fetch(`${repoBase}/plugins`, { headers });
    if (pluginsDirRes.ok) {
      const pluginsDirEntries: any[] = await pluginsDirRes.json();
      const pluginDirs = pluginsDirEntries.filter((e: any) => e.type === 'dir');

      for (const pluginDir of pluginDirs) {
        try {
          // Try to fetch plugin.json
          const pluginJsonRes = await fetch(`${repoBase}/plugins/${pluginDir.name}/plugin.json`, { headers });
          if (!pluginJsonRes.ok) continue;

          const pluginJsonContent: any = await pluginJsonRes.json();
          // GitHub API returns base64-encoded content
          const pluginMeta = JSON.parse(
            Buffer.from(pluginJsonContent.content, 'base64').toString('utf-8'),
          );

          pluginCount++;
          const pluginId = `plugin-${pluginDir.name}`;

          // Check for skills/ subdirectory
          const skillsDirRes = await fetch(`${repoBase}/plugins/${pluginDir.name}/skills`, { headers });
          if (skillsDirRes.ok) {
            const skillEntries: any[] = await skillsDirRes.json();
            const mdFiles = skillEntries.filter((e: any) => e.name.endsWith('.md'));

            for (const mdFile of mdFiles) {
              try {
                const skillRes = await fetch(mdFile.download_url, { headers });
                if (!skillRes.ok) continue;

                const content = await skillRes.text();
                const skillId = `${pluginDir.name}-${mdFile.name.replace('.md', '')}`;

                // Parse YAML frontmatter (simple extraction)
                let skillName = mdFile.name.replace('.md', '');
                let skillDescription = '';
                const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
                if (frontmatterMatch) {
                  const fm = frontmatterMatch[1];
                  const nameMatch = fm.match(/^name:\s*(.+)$/m);
                  const descMatch = fm.match(/^description:\s*(.+)$/m);
                  if (nameMatch) skillName = nameMatch[1].trim().replace(/^['"]|['"]$/g, '');
                  if (descMatch) skillDescription = descMatch[1].trim().replace(/^['"]|['"]$/g, '');
                }

                // Preserve existing enabled state if already in DB
                const isEnabled = enabledSkillIds.has(skillId);

                // Update or add to existing skills
                const existingIdx = existingSkills.findIndex((s: any) => s.id === skillId);
                const skillEntry = {
                  id: skillId,
                  name: skillName,
                  description: skillDescription,
                  source: pluginDir.name,
                  tags: [],
                  enabled: existingIdx >= 0 ? existingSkills[existingIdx].enabled : isEnabled,
                };

                if (existingIdx >= 0) {
                  // Update metadata but preserve enabled state
                  existingSkills[existingIdx] = { ...existingSkills[existingIdx], ...skillEntry, enabled: existingSkills[existingIdx].enabled };
                } else {
                  existingSkills.push(skillEntry);
                }
                skillCount++;
              } catch (e: any) {
                errors.push(`Failed to parse skill ${mdFile.name}: ${e.message}`);
              }
            }
          }
        } catch (e: any) {
          errors.push(`Failed to process plugin ${pluginDir.name}: ${e.message}`);
        }
      }
    } else if (pluginsDirRes.status === 404) {
      // No plugins directory — that's fine, use seed data
      errors.push('No plugins/ directory found in agentic-work/openagentic');
    } else {
      errors.push(`GitHub API error (${pluginsDirRes.status}): ${pluginsDirRes.statusText}`);
    }
  } catch (e: any) {
    errors.push(`GitHub fetch failed: ${e.message}`);
  }

  // Save updated data back to DB
  try {
    await Promise.all([
      setCodemodeConfig('skills', existingSkills),
      setCodemodeConfig('plugins', existingPlugins),
      setCodemodeConfig('mcp-servers', existingMcpServers),
    ]);
  } catch (e: any) {
    errors.push(`Failed to save sync results: ${e.message}`);
    return { ok: false, pluginCount, skillCount, mcpCount, errors };
  }

  skillCount = skillCount || existingSkills.length;
  pluginCount = pluginCount || existingPlugins.length;
  mcpCount = existingMcpServers.length;

  return {
    ok: errors.length === 0,
    pluginCount,
    skillCount,
    mcpCount,
    errors,
  };
}
