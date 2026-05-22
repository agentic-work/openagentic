export type SlashCommandUi = 'none' | 'picker' | 'form' | 'modal' | 'custom';
export type SlashCommandPriority = 'p0' | 'p1' | 'p2' | 'p3';

export interface SlashCommand {
  name: string;
  description: string;
  ui: SlashCommandUi;
  priority: SlashCommandPriority;
  /** Display alias — shown in the palette next to the name, e.g. "reset". */
  aliases?: string[];
  /** Optional signature hint, e.g. "[path]" or "[enable|disable]". */
  args?: string;
  /** Internal / hidden — don't show in the public palette. */
  hidden?: boolean;
  /**
   * If set, the command opens a native React picker in the browser
   * (via the `daemon_request` RPC) rather than running on the daemon.
   * Picker commands are submitted *immediately* on Enter even when an
   * `args` signature is also declared — the picker IS the args UI, so
   * the palette must not insert `/<name> ` and wait. Mirrors how
   * openagentic's TUI immediately enters its picker on Enter.
   */
  picker?: 'skills' | 'plugins' | 'mcp' | 'model' | 'agents';
}

/**
 * The list is exhaustive through p3. Commands marked `hidden: true`
 * are still recognized if the user types them explicitly but don't
 * appear in the `/` palette. Order within a priority is alphabetical.
 */
export const SLASH_COMMANDS: SlashCommand[] = [
  // ── p0 essentials ──────────────────────────────────────────────
  { name: 'clear', description: 'Clear conversation history and free up context', ui: 'none', priority: 'p0', aliases: ['reset', 'new'] },
  { name: 'compact', description: 'Clear history but keep summary in context', ui: 'none', priority: 'p0', args: '[summary-args]' },
  { name: 'config', description: 'Open the settings panel', ui: 'modal', priority: 'p0', aliases: ['settings'] },
  { name: 'context', description: 'Visualize current context usage', ui: 'custom', priority: 'p0' },
  { name: 'cost', description: 'Show session cost and duration', ui: 'none', priority: 'p0' },
  { name: 'exit', description: 'Exit the session', ui: 'none', priority: 'p0', aliases: ['quit'] },
  { name: 'help', description: 'Show available commands', ui: 'none', priority: 'p0' },
  { name: 'model', description: 'Change the active model', ui: 'picker', priority: 'p0', picker: 'model' },
  { name: 'permissions', description: 'Manage allow/deny tool permission rules', ui: 'form', priority: 'p0', aliases: ['allowed-tools'] },
  { name: 'theme', description: 'Change the UI theme', ui: 'picker', priority: 'p0', args: '[dark|light]' },

  // ── p1 common ──────────────────────────────────────────────────
  { name: 'agents', description: 'Manage agent configurations', ui: 'picker', priority: 'p1', picker: 'agents' },
  // /btw — TUI parity: bare `/btw` submits immediately (daemon replies
  // "Usage: /btw"). Args are optional, so we drop the `args` hint to
  // avoid the palette inserting `/btw ` and stalling on Enter.
  // Captured 2026-05-02 in tui-vs-codemode-diff.report.md.
  { name: 'btw', description: 'Ask a quick side question without interrupting', ui: 'none', priority: 'p1' },
  { name: 'login', description: 'Sign in / switch OpenAgentic accounts', ui: 'form', priority: 'p1' },
  { name: 'logout', description: 'Sign out from OpenAgentic', ui: 'none', priority: 'p1' },
  { name: 'mcp', description: 'Manage MCP servers', ui: 'picker', priority: 'p1', args: '[enable|disable [name]]', picker: 'mcp' },
  { name: 'plan', description: 'Enter plan mode or view current plan', ui: 'modal', priority: 'p1', args: '[open|<description>]' },
  { name: 'remote-control', description: 'Connect for remote-control sessions', ui: 'custom', priority: 'p1', aliases: ['rc'] },
  { name: 'resume', description: 'Resume a previous conversation', ui: 'picker', priority: 'p1', aliases: ['continue'] },
  { name: 'skills', description: 'List available skills', ui: 'none', priority: 'p1', picker: 'skills' },
  { name: 'status', description: 'Show session status', ui: 'none', priority: 'p1' },

  // ── p2 secondary ───────────────────────────────────────────────
  { name: 'add-dir', description: 'Add a working directory to the sandbox', ui: 'form', priority: 'p2', args: '<path>' },
  { name: 'branch', description: 'Create a conversation branch at this point', ui: 'form', priority: 'p2', args: '[name]', aliases: ['fork'] },
  { name: 'color', description: 'Set the prompt color for this session', ui: 'picker', priority: 'p2' },
  { name: 'copy', description: 'Copy the last response to the clipboard', ui: 'none', priority: 'p2', args: '[n]' },
  { name: 'diff', description: 'View uncommitted changes and per-turn diffs', ui: 'custom', priority: 'p2' },
  { name: 'effort', description: 'Set effort level', ui: 'picker', priority: 'p2', args: '[low|medium|high|max|auto]' },
  { name: 'export', description: 'Export the conversation', ui: 'form', priority: 'p2', args: '[filename]' },
  { name: 'fast', description: 'Toggle fast mode', ui: 'picker', priority: 'p2', args: '[on|off]' },
  { name: 'hooks', description: 'View hook configurations', ui: 'none', priority: 'p2' },
  { name: 'keybindings', description: 'Open the keybindings config', ui: 'none', priority: 'p2' },
  { name: 'memory', description: 'Edit persistent memory files', ui: 'form', priority: 'p2' },
  { name: 'pr-comments', description: 'Fetch comments from a GitHub PR', ui: 'none', priority: 'p2' },
  { name: 'release-notes', description: 'View release notes', ui: 'none', priority: 'p2' },
  { name: 'rewind', description: 'Restore to a previous point', ui: 'picker', priority: 'p2', aliases: ['checkpoint'] },
  { name: 'sandbox', description: 'Toggle the code-execution sandbox', ui: 'form', priority: 'p2' },
  { name: 'share', description: 'Share this conversation', ui: 'none', priority: 'p2' },
  { name: 'tag', description: 'Toggle a searchable tag on this session', ui: 'none', priority: 'p2', args: '<tag-name>' },
  { name: 'tasks', description: 'List and manage background tasks', ui: 'custom', priority: 'p2', aliases: ['bashes'] },
  // /tools — TUI parity: bare `/tools` submits and lists every tool grouped
  // by category. Args are optional drilldown (`/tools <tool>` shows one),
  // so dropping the `args` hint avoids the palette stalling on Enter.
  // Captured 2026-05-02 in tui-vs-codemode-diff.report.md.
  { name: 'tools', description: 'List tools and per-tool config', ui: 'none', priority: 'p2' },
  { name: 'budget', description: 'View or set token budget for the session', ui: 'none', priority: 'p2', args: '[<limit>]' },
  { name: 'batch', description: 'Queue multiple prompts for sequential execution', ui: 'custom', priority: 'p2' },
  { name: 'enter-worktree', description: 'Create and switch to an isolated git worktree', ui: 'none', priority: 'p2', args: '[branch] [path]' },
  { name: 'exit-worktree', description: 'Leave the current worktree and return to the main workspace', ui: 'none', priority: 'p2' },
  { name: 'env', description: 'View or set environment variables for the session', ui: 'none', priority: 'p2', args: '[KEY=VALUE]' },
  { name: 'install', description: 'Install a CLI tool or package', ui: 'none', priority: 'p2', args: '<package>' },
  { name: 'plugin', description: 'Manage plugins', ui: 'custom', priority: 'p2', args: '[list|install|remove]', aliases: ['plugins'], picker: 'plugins' },
  { name: 'sounds', description: 'Toggle turn-complete notification sounds', ui: 'none', priority: 'p2' },
  { name: 'sandbox-toggle', description: 'Toggle sandbox mode for the session', ui: 'none', priority: 'p2' },

  // ── p3 debug / internal ─────────────────────────────────────────
  { name: 'advisor', description: 'Set or show the advisor model', ui: 'none', priority: 'p3' },
  { name: 'openagenticplatform', description: 'Show OpenAgentic diagnostics', ui: 'none', priority: 'p3' },
  { name: 'brief', description: 'Toggle brief reasoning mode', ui: 'none', priority: 'p3' },
  { name: 'commit', description: 'Commit staged changes with a message', ui: 'none', priority: 'p3' },
  { name: 'commit-push-pr', description: 'Commit, push, and open a PR', ui: 'none', priority: 'p3' },
  { name: 'doctorCli', description: 'Diagnostic CLI tools', ui: 'none', priority: 'p3', hidden: true },
  { name: 'files', description: 'List all files in context', ui: 'none', priority: 'p3' },
  { name: 'init', description: 'Set up OPENAGENTIC.md for the repo', ui: 'none', priority: 'p3' },
  { name: 'init-verifiers', description: 'Create verifier skills for testing', ui: 'none', priority: 'p3' },
  { name: 'insights', description: 'Code insights and analytics', ui: 'none', priority: 'p3' },
  { name: 'logsCli', description: 'View debug logs', ui: 'none', priority: 'p3', hidden: true },
  { name: 'output-style', description: 'Deprecated: use /config instead', ui: 'none', priority: 'p3', hidden: true },
  { name: 'perf-issue', description: 'Report a performance issue', ui: 'none', priority: 'p3', hidden: true },
  { name: 'privacy-settings', description: 'Privacy settings', ui: 'form', priority: 'p3' },
  { name: 'reload-plugins', description: 'Reload plugins', ui: 'none', priority: 'p3' },
  { name: 'remote-env', description: 'Set a remote environment variable', ui: 'none', priority: 'p3', hidden: true },
  { name: 'remote-setup', description: 'Configure a remote execution backend', ui: 'none', priority: 'p3', hidden: true },
  { name: 'rename', description: 'Rename this session', ui: 'form', priority: 'p3' },
  { name: 'reset-limits', description: 'Reset usage limits', ui: 'none', priority: 'p3' },
  { name: 'review', description: 'Review uncommitted code changes', ui: 'none', priority: 'p3' },
  { name: 'security-review', description: 'Run a security review', ui: 'none', priority: 'p3' },
  { name: 'session', description: 'Show session details', ui: 'none', priority: 'p3' },
  { name: 'stats', description: 'Show usage statistics', ui: 'none', priority: 'p3' },
  { name: 'summary', description: 'Summarize the current conversation', ui: 'none', priority: 'p3' },
  { name: 'teleport', description: 'Teleport the session to another pod', ui: 'none', priority: 'p3', hidden: true },
  { name: 'terminal-setup', description: 'Configure terminal integration', ui: 'none', priority: 'p3', hidden: true },
  { name: 'ultraplan', description: 'Extended plan mode', ui: 'modal', priority: 'p3' },
  { name: 'version', description: 'Show the OpenAgentic version', ui: 'none', priority: 'p3' },
  { name: 'workflow', description: 'Run a workflow', ui: 'none', priority: 'p3' },
  { name: 'workflows', description: 'List and manage workflows', ui: 'none', priority: 'p2' },
  { name: 'assistant', description: 'Switch to assistant mode', ui: 'none', priority: 'p2' },
  { name: 'autofix-pr', description: 'Auto-fix a PR based on review comments', ui: 'none', priority: 'p2', args: '<pr-url>' },
  { name: 'issue', description: 'Work on a GitHub issue', ui: 'none', priority: 'p2', args: '<issue-url>' },
  { name: 'pr-comments', description: 'Fetch and address PR review comments', ui: 'none', priority: 'p2', args: '<pr-url>', aliases: ['pr_comments'] },
  { name: 'onboarding', description: 'Start the onboarding flow', ui: 'none', priority: 'p3' },
  { name: 'install-github-app', description: 'Install the OpenAgentic GitHub App', ui: 'none', priority: 'p3' },
  { name: 'bridge', description: 'Start a remote bridge session', ui: 'none', priority: 'p3', hidden: true },
  { name: 'extra-usage', description: 'Show extended usage metrics', ui: 'none', priority: 'p3', hidden: true },
  { name: 'backfill-sessions', description: 'Backfill session metadata (admin)', ui: 'none', priority: 'p3', hidden: true },
  { name: 'statusline', description: 'Configure the status line display', ui: 'none', priority: 'p3', hidden: true },
  { name: 'fork', description: 'Fork the current conversation', ui: 'none', priority: 'p2' },
];

/**
 * Filter visible commands for a given query. Matches against name and
 * aliases case-insensitively, sorted by: exact prefix match > priority
 * > alphabetical. Hidden commands appear only when an exact name match
 * is typed.
 */
/**
 * Resolve a slash-command by name (case-insensitive) OR by alias.
 * Returns undefined when nothing matches. Used by the palette commit
 * path to decide whether to submit immediately (no args) or to insert
 * a stub like `/files ` so the user can type the path.
 */
export function findSlashCommand(name: string): SlashCommand | undefined {
  const q = name.toLowerCase().replace(/^\//, '');
  return SLASH_COMMANDS.find(
    (c) => c.name === q || (c.aliases?.includes(q) ?? false),
  );
}

/**
 * Daemon-emitted plugin command names (e.g. `superpowers:test-driven-development`)
 * arrive as bare strings in `system_init.slash_commands`. Synthesize a
 * SlashCommand stub for each name not already in the static registry so
 * the palette can show them. Priority is `p1` (visible by default but
 * below built-ins). Description marks them as plugin-supplied.
 *
 * 2026-05-02 user feedback: "loaded plugins don't show in slash after
 * install". The palette was reading SLASH_COMMANDS only; daemon-supplied
 * plugin commands had nowhere to land. After /reload-plugins fires
 * post-install, sessionMeta.slashCommands updates with the new names.
 */
export function commandsFromDaemonNames(
  names: ReadonlyArray<string>,
): SlashCommand[] {
  if (!names || names.length === 0) return [];
  const knownNames = new Set(SLASH_COMMANDS.map((c) => c.name));
  for (const c of SLASH_COMMANDS) {
    if (c.aliases) for (const a of c.aliases) knownNames.add(a);
  }
  const out: SlashCommand[] = [];
  for (const raw of names) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim().replace(/^\//, '');
    if (!name || knownNames.has(name)) continue;
    knownNames.add(name);
    out.push({
      name,
      // Plugin commands typically use `pluginName:commandName` format.
      // Surface the prefix in the description so users can see what
      // plugin shipped this command without expanding details.
      description: name.includes(':')
        ? `(plugin · ${name.split(':')[0]})`
        : '(plugin command)',
      ui: 'none',
      priority: 'p1',
    });
  }
  return out;
}

/**
 * Surface plugin skills (e.g. `brainstorming`, `test-driven-development`,
 * `systematic-debugging` from superpowers) as virtual slash commands so
 * the user can type `/brain` or `/test` and get the matching skill in
 * the picker — same UX they expect from openagentic/Claude Code TUI.
 *
 * Skills aren't real slash commands — they're invoked by the model
 * mid-turn — but exposing them in the palette gives users a single
 * keystroke to find and trigger them. Selecting a skill from the
 * picker dispatches `/<skill-name>` which the daemon routes through
 * its skill-invocation handler.
 *
 * Skills sort below daemon-named plugin commands (priority p2 vs p1)
 * so explicit slash commands win when both match the query.
 */
export function commandsFromSkillNames(
  skills: ReadonlyArray<string>,
): SlashCommand[] {
  if (!skills || skills.length === 0) return [];
  const knownNames = new Set(SLASH_COMMANDS.map((c) => c.name));
  for (const c of SLASH_COMMANDS) {
    if (c.aliases) for (const a of c.aliases) knownNames.add(a);
  }
  const out: SlashCommand[] = [];
  for (const raw of skills) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim().replace(/^\//, '');
    if (!name || knownNames.has(name)) continue;
    knownNames.add(name);
    out.push({
      name,
      description: '(skill)',
      ui: 'none',
      priority: 'p2',
    });
  }
  return out;
}

export function filterSlashCommands(
  query: string,
  limit = 80,
  extraCommands: ReadonlyArray<SlashCommand> = [],
): SlashCommand[] {
  const q = query.toLowerCase().replace(/^\//, '');
  const pool = extraCommands.length > 0
    ? [...SLASH_COMMANDS, ...extraCommands]
    : SLASH_COMMANDS;
  const candidates = pool.filter((c) => {
    // Show ALL commands when query is empty or matches — openagentic
    // TUI lists every command in its / palette. Hidden commands only
    // hide when there's a non-matching query.
    if (c.hidden && q && c.name !== q && !(c.aliases?.includes(q))) return false;
    if (!q) return true;
    if (c.name.startsWith(q)) return true;
    if (c.name.includes(q)) return true;
    if (c.aliases?.some((a) => a.startsWith(q) || a.includes(q))) return true;
    return false;
  });

  const priorityWeight: Record<SlashCommandPriority, number> = {
    p0: 0,
    p1: 1,
    p2: 2,
    p3: 3,
  };

  candidates.sort((a, b) => {
    const ap = a.name.startsWith(q) ? 0 : 1;
    const bp = b.name.startsWith(q) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const apr = priorityWeight[a.priority];
    const bpr = priorityWeight[b.priority];
    if (apr !== bpr) return apr - bpr;
    // 2026-05-02 user feedback: plugin commands (e.g.
    // `superpowers:brainstorming`) should sort AFTER built-ins, not
    // interleave alphabetically. Mirrors openagentic TUI / Claude Code
    // palette ordering where built-ins come first, then plugin
    // commands grouped by plugin source.
    const aIsPlugin = a.name.includes(':');
    const bIsPlugin = b.name.includes(':');
    if (aIsPlugin !== bIsPlugin) return aIsPlugin ? 1 : -1;
    return a.name.localeCompare(b.name);
  });

  return candidates.slice(0, limit);
}
