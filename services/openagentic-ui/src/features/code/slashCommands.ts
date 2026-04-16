/**
 * Slash command registry for the React CodeMode view.
 *
 * Ported 1:1 from openagentic's src/commands/ — the full inventory is
 * in slash-commands-inventory.md. This file is the runtime-typed
 * version that the slash command palette renders from and the command
 * dispatcher routes against.
 *
 * Priority:
 *   p0 — essential, must work before the port ships
 *   p1 — commonly used, should port early
 *   p2 — less common, can stub initially
 *   p3 — debug / feature-gated / internal, stub OK
 *
 * UI shape:
 *   none   — state-mutating, prints a line, no interactive UI
 *   picker — CustomSelect/dropdown of choices
 *   form   — multi-field input widget
 *   modal  — fullscreen overlay (Settings, Plan, etc.)
 *   custom — bespoke React tree
 *
 * @copyright 2025 Openagentic LLC
 * @license PROPRIETARY
 */

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
  { name: 'model', description: 'Change the active model', ui: 'picker', priority: 'p0' },
  { name: 'permissions', description: 'Manage allow/deny tool permission rules', ui: 'form', priority: 'p0', aliases: ['allowed-tools'] },
  { name: 'theme', description: 'Change the UI theme', ui: 'picker', priority: 'p0', args: '[dark|light]' },

  // ── p1 common ──────────────────────────────────────────────────
  { name: 'agents', description: 'Manage agent configurations', ui: 'custom', priority: 'p1' },
  { name: 'btw', description: 'Ask a quick side question without interrupting', ui: 'none', priority: 'p1', args: '<question>' },
  { name: 'login', description: 'Sign in / switch OpenAgentic accounts', ui: 'form', priority: 'p1' },
  { name: 'logout', description: 'Sign out from OpenAgentic', ui: 'none', priority: 'p1' },
  { name: 'mcp', description: 'Manage MCP servers', ui: 'picker', priority: 'p1', args: '[enable|disable [name]]' },
  { name: 'plan', description: 'Enter plan mode or view current plan', ui: 'modal', priority: 'p1', args: '[open|<description>]' },
  { name: 'remote-control', description: 'Connect for remote-control sessions', ui: 'custom', priority: 'p1', aliases: ['rc'] },
  { name: 'resume', description: 'Resume a previous conversation', ui: 'picker', priority: 'p1', aliases: ['continue'] },
  { name: 'skills', description: 'List available skills', ui: 'none', priority: 'p1' },
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
  { name: 'tools', description: 'List tools and per-tool config', ui: 'none', priority: 'p2', args: '[<tool> <key> <value>]' },
  { name: 'budget', description: 'View or set token budget for the session', ui: 'none', priority: 'p2', args: '[<limit>]' },
  { name: 'batch', description: 'Queue multiple prompts for sequential execution', ui: 'custom', priority: 'p2' },
  { name: 'enter-worktree', description: 'Create and switch to an isolated git worktree', ui: 'none', priority: 'p2', args: '[branch] [path]' },
  { name: 'exit-worktree', description: 'Leave the current worktree and return to the main workspace', ui: 'none', priority: 'p2' },
  { name: 'env', description: 'View or set environment variables for the session', ui: 'none', priority: 'p2', args: '[KEY=VALUE]' },
  { name: 'install', description: 'Install a CLI tool or package', ui: 'none', priority: 'p2', args: '<package>' },
  { name: 'plugin', description: 'Manage plugins', ui: 'custom', priority: 'p2', args: '[list|install|remove]', aliases: ['plugins'] },
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
export function filterSlashCommands(query: string, limit = 80): SlashCommand[] {
  const q = query.toLowerCase().replace(/^\//, '');
  const candidates = SLASH_COMMANDS.filter((c) => {
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
    return a.name.localeCompare(b.name);
  });

  return candidates.slice(0, limit);
}
