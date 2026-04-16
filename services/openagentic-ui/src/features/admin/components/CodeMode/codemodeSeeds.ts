/**
 * CodeMode Seed Data
 *
 * Real skills and MCP servers sourced from installed Claude Code plugins.
 * These serve as platform defaults — admins toggle which ones get injected
 * into every user's code mode session via managed-mcp.json and skills/*.md.
 *
 * Source: ~/.claude/plugins/cache/claude-plugins-official/
 */

// --- Skills ---

export interface SeedSkill {
  id: string;
  name: string;
  description: string;
  source: 'superpowers' | 'claude-md-management' | 'frontend-design' | 'custom';
  tags: string[];
  enabled: boolean;
}

export const SEED_SKILLS: SeedSkill[] = [
  // superpowers plugin (14 skills)
  {
    id: 'sp-brainstorming',
    name: 'brainstorming',
    description: 'Explores user intent, requirements and design before implementation. MUST use before any creative work.',
    source: 'superpowers',
    tags: ['process', 'design'],
    enabled: true,
  },
  {
    id: 'sp-writing-plans',
    name: 'writing-plans',
    description: 'Create detailed implementation plans from specs or requirements, before touching code.',
    source: 'superpowers',
    tags: ['process', 'planning'],
    enabled: true,
  },
  {
    id: 'sp-executing-plans',
    name: 'executing-plans',
    description: 'Execute written implementation plans in a separate session with review checkpoints.',
    source: 'superpowers',
    tags: ['process', 'execution'],
    enabled: true,
  },
  {
    id: 'sp-test-driven-development',
    name: 'test-driven-development',
    description: 'Red-Green-Refactor TDD cycle. Use before writing implementation code.',
    source: 'superpowers',
    tags: ['process', 'testing'],
    enabled: true,
  },
  {
    id: 'sp-systematic-debugging',
    name: 'systematic-debugging',
    description: 'Structured debugging methodology. Use when encountering any bug, test failure, or unexpected behavior.',
    source: 'superpowers',
    tags: ['process', 'debugging'],
    enabled: true,
  },
  {
    id: 'sp-verification-before-completion',
    name: 'verification-before-completion',
    description: 'Evidence-based verification before claiming success. Run verification commands and confirm output before any success claims.',
    source: 'superpowers',
    tags: ['process', 'quality'],
    enabled: true,
  },
  {
    id: 'sp-requesting-code-review',
    name: 'requesting-code-review',
    description: 'Request code review from subagents when completing tasks, implementing features, or before merging.',
    source: 'superpowers',
    tags: ['process', 'review'],
    enabled: true,
  },
  {
    id: 'sp-receiving-code-review',
    name: 'receiving-code-review',
    description: 'Receive and respond to code review feedback with technical rigor, not blind agreement.',
    source: 'superpowers',
    tags: ['process', 'review'],
    enabled: false,
  },
  {
    id: 'sp-dispatching-parallel-agents',
    name: 'dispatching-parallel-agents',
    description: 'Delegate 2+ independent tasks to parallel agents without shared state or sequential dependencies.',
    source: 'superpowers',
    tags: ['process', 'agents'],
    enabled: true,
  },
  {
    id: 'sp-subagent-driven-development',
    name: 'subagent-driven-development',
    description: 'Execute implementation plans with per-task subagents and two-stage review.',
    source: 'superpowers',
    tags: ['process', 'agents'],
    enabled: true,
  },
  {
    id: 'sp-using-git-worktrees',
    name: 'using-git-worktrees',
    description: 'Create isolated git worktrees for feature work. Smart directory selection and safety verification.',
    source: 'superpowers',
    tags: ['git', 'workflow'],
    enabled: false,
  },
  {
    id: 'sp-finishing-a-development-branch',
    name: 'finishing-a-development-branch',
    description: 'Guide completion of dev work — structured options for merge, PR, or cleanup.',
    source: 'superpowers',
    tags: ['git', 'workflow'],
    enabled: false,
  },
  {
    id: 'sp-writing-skills',
    name: 'writing-skills',
    description: 'Create and test new skills using TDD. Use when building or editing skills.',
    source: 'superpowers',
    tags: ['meta', 'skills'],
    enabled: false,
  },
  {
    id: 'sp-using-superpowers',
    name: 'using-superpowers',
    description: 'Entry point — establishes how to find and use skills. Invoked at conversation start.',
    source: 'superpowers',
    tags: ['meta', 'core'],
    enabled: true,
  },
  // claude-md-management plugin (1 skill)
  {
    id: 'cmd-claude-md-improver',
    name: 'claude-md-improver',
    description: 'Audit and improve CLAUDE.md files. Scans, evaluates quality, outputs report, makes targeted updates.',
    source: 'claude-md-management',
    tags: ['docs', 'maintenance'],
    enabled: false,
  },
  // frontend-design plugin (1 skill)
  {
    id: 'fd-frontend-design',
    name: 'frontend-design',
    description: 'Create distinctive, production-grade frontend interfaces. Generates polished code avoiding generic AI aesthetics.',
    source: 'frontend-design',
    tags: ['ui', 'design'],
    enabled: true,
  },
];

// --- MCP Servers ---

export interface SeedMcpServer {
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

export const SEED_MCP_SERVERS: SeedMcpServer[] = [
  {
    id: 'mcp-context7',
    name: 'context7',
    description: 'Upstash Context7 — fetch current library/framework documentation directly from source repos into LLM context.',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
    pluginSource: 'context7',
    enabled: true,
  },
  {
    id: 'mcp-playwright',
    name: 'playwright',
    description: 'Microsoft Playwright — browser automation, screenshots, form filling, E2E testing workflows.',
    type: 'stdio',
    command: 'npx',
    args: ['@playwright/mcp@latest'],
    pluginSource: 'playwright',
    enabled: false,
  },
  {
    id: 'mcp-github',
    name: 'github',
    description: 'GitHub MCP — repos, issues, PRs, code search, actions. Requires GITHUB_PERSONAL_ACCESS_TOKEN.',
    type: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    headers: { 'Authorization': 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}' },
    pluginSource: 'github',
    enabled: false,
  },
];

// --- Plugins (meta, for the Plugins tab) ---

export interface SeedPlugin {
  id: string;
  name: string;
  version: string;
  description: string;
  provides: { skills: number; mcpServers: number; hooks: number };
  enabled: boolean;
  source: 'marketplace';
}

export const SEED_PLUGINS: SeedPlugin[] = [
  {
    id: 'plugin-superpowers',
    name: 'superpowers',
    version: '5.0.7',
    description: 'Core skills library: TDD, debugging, collaboration patterns, and proven techniques.',
    provides: { skills: 14, mcpServers: 0, hooks: 0 },
    enabled: true,
    source: 'marketplace',
  },
  {
    id: 'plugin-context7',
    name: 'context7',
    version: 'latest',
    description: 'Up-to-date library documentation lookup via Upstash Context7 MCP.',
    provides: { skills: 0, mcpServers: 1, hooks: 0 },
    enabled: true,
    source: 'marketplace',
  },
  {
    id: 'plugin-playwright',
    name: 'playwright',
    version: 'latest',
    description: 'Browser automation and E2E testing MCP server by Microsoft.',
    provides: { skills: 0, mcpServers: 1, hooks: 0 },
    enabled: false,
    source: 'marketplace',
  },
  {
    id: 'plugin-github',
    name: 'github',
    version: 'latest',
    description: 'GitHub integration — repos, issues, PRs, code search via MCP.',
    provides: { skills: 0, mcpServers: 1, hooks: 0 },
    enabled: false,
    source: 'marketplace',
  },
  {
    id: 'plugin-frontend-design',
    name: 'frontend-design',
    version: 'latest',
    description: 'Create distinctive, production-grade frontend interfaces with high design quality.',
    provides: { skills: 1, mcpServers: 0, hooks: 0 },
    enabled: true,
    source: 'marketplace',
  },
  {
    id: 'plugin-claude-md-management',
    name: 'claude-md-management',
    version: '1.0.0',
    description: 'Audit and improve CLAUDE.md files in repositories.',
    provides: { skills: 1, mcpServers: 0, hooks: 0 },
    enabled: false,
    source: 'marketplace',
  },
  {
    id: 'plugin-code-review',
    name: 'code-review',
    version: 'latest',
    description: 'Code review plugin with confidence-based filtering.',
    provides: { skills: 0, mcpServers: 0, hooks: 0 },
    enabled: true,
    source: 'marketplace',
  },
  {
    id: 'plugin-code-simplifier',
    name: 'code-simplifier',
    version: '1.0.0',
    description: 'Simplify and refine code for clarity, consistency, and maintainability.',
    provides: { skills: 0, mcpServers: 0, hooks: 0 },
    enabled: true,
    source: 'marketplace',
  },
  {
    id: 'plugin-feature-dev',
    name: 'feature-dev',
    version: 'latest',
    description: 'Guided feature development with codebase understanding and architecture focus.',
    provides: { skills: 0, mcpServers: 0, hooks: 0 },
    enabled: true,
    source: 'marketplace',
  },
  {
    id: 'plugin-ralph-loop',
    name: 'ralph-loop',
    version: 'latest',
    description: 'Ralph Loop — recurring prompt/command runner framework.',
    provides: { skills: 0, mcpServers: 0, hooks: 0 },
    enabled: false,
    source: 'marketplace',
  },
  {
    id: 'plugin-security-guidance',
    name: 'security-guidance',
    version: 'latest',
    description: 'Security best practices and vulnerability guidance.',
    provides: { skills: 0, mcpServers: 0, hooks: 0 },
    enabled: false,
    source: 'marketplace',
  },
  {
    id: 'plugin-typescript-lsp',
    name: 'typescript-lsp',
    version: 'latest',
    description: 'TypeScript language server integration.',
    provides: { skills: 0, mcpServers: 0, hooks: 0 },
    enabled: false,
    source: 'marketplace',
  },
];

// --- Registries ---

export interface SeedRegistry {
  name: string;
  url: string;
  official: boolean;
}

export const SEED_REGISTRIES: SeedRegistry[] = [
  {
    name: 'Claude Code Official',
    url: 'https://github.com/agentic-work/openagentic',
    official: true,
  },
];
