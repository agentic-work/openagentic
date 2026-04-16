export type ToolRenderer = (input: Record<string, unknown>) => string;

function str(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
}

function shortPath(path: string): string {
  // Collapse /workspaces/<uuid>/ prefix so the summary doesn't get
  // dominated by the sandbox workspace root.
  return path.replace(/^\/workspaces\/[^/]+\//, '');
}

function firstLine(s: string): string {
  const idx = s.indexOf('\n');
  return idx < 0 ? s : s.slice(0, idx);
}

const renderers: Record<string, ToolRenderer> = {
  // ── command execution ─────────────────────────────────────────────
  Bash: (i) => truncate(firstLine(str(i.command)), 80),
  PowerShell: (i) => truncate(firstLine(str(i.command)), 80),
  REPL: (i) => truncate(firstLine(str(i.code ?? i.command)), 80),

  // ── file I/O ──────────────────────────────────────────────────────
  Read: (i) => {
    const p = shortPath(str(i.file_path ?? i.path ?? ''));
    const offset = num(i.offset);
    const limit = num(i.limit);
    if (offset || limit) return truncate(`${p} [${offset ?? 0}..${limit ? (offset ?? 0) + limit : '?'}]`, 80);
    return truncate(p, 80);
  },
  Write: (i) => truncate(shortPath(str(i.file_path ?? i.path ?? '')), 80),
  Edit: (i) => {
    const p = shortPath(str(i.file_path ?? i.path ?? ''));
    const all = i.replace_all === true ? ' [all]' : '';
    return truncate(`${p}${all}`, 80);
  },
  FileRead: (i) => truncate(shortPath(str(i.file_path ?? i.path ?? '')), 80),
  FileWrite: (i) => truncate(shortPath(str(i.file_path ?? i.path ?? '')), 80),
  FileEdit: (i) => truncate(shortPath(str(i.file_path ?? i.path ?? '')), 80),
  EditTransaction: (i) => {
    const edits = Array.isArray(i.edits) ? i.edits.length : 0;
    return edits > 0 ? `${edits} edit${edits === 1 ? '' : 's'}` : '(edit transaction)';
  },
  NotebookEdit: (i) => truncate(shortPath(str(i.notebook_path ?? i.path ?? '')), 80),

  // ── search ────────────────────────────────────────────────────────
  Glob: (i) => truncate(str(i.pattern ?? ''), 80),
  Grep: (i) => {
    const pattern = str(i.pattern ?? '');
    const path = i.path ? ` in ${shortPath(str(i.path))}` : '';
    return truncate(`"${pattern}"${path}`, 80);
  },
  Symbol: (i) => truncate(str(i.name ?? i.symbol ?? i.query ?? ''), 80),
  LSP: (i) => truncate(str(i.operation ?? i.method ?? 'lsp'), 80),
  Diff: (i) => {
    const base = str(i.base ?? 'HEAD');
    const paths = Array.isArray(i.paths) ? (i.paths as string[]).join(' ') : '';
    return truncate(`${base}${paths ? ` — ${paths}` : ''}`, 80);
  },

  // ── web / search ──────────────────────────────────────────────────
  WebFetch: (i) => truncate(str(i.url ?? ''), 80),
  WebSearch: (i) => truncate(str(i.query ?? ''), 80),
  WebBrowser: (i) => truncate(str(i.url ?? i.action ?? ''), 80),

  // ── task / subagent ───────────────────────────────────────────────
  Agent: (i) => truncate(str(i.description ?? i.prompt ?? ''), 80),
  Task: (i) => truncate(str(i.description ?? i.prompt ?? ''), 80),
  TaskCreate: (i) => truncate(str(i.subject ?? i.description ?? ''), 80),
  TaskUpdate: (i) => truncate(str(i.taskId ?? i.subject ?? ''), 80),
  TaskGet: (i) => truncate(str(i.taskId ?? ''), 40),
  TaskList: () => '(list tasks)',
  TaskOutput: (i) => truncate(str(i.task_id ?? i.taskId ?? ''), 40),
  TaskStop: (i) => truncate(str(i.shell_id ?? i.taskId ?? ''), 40),

  // ── plan / worktree / workflow ────────────────────────────────────
  EnterPlanMode: (i) => truncate(str(i.message ?? ''), 80),
  ExitPlanMode: (i) => truncate(firstLine(str(i.plan ?? '')), 80),
  ExitPlanModeV2: (i) => truncate(firstLine(str(i.plan ?? '')), 80),
  EnterWorktree: (i) => {
    const path = str(i.worktreePath ?? '');
    const branch = i.worktreeBranch ? ` @ ${str(i.worktreeBranch)}` : '';
    return truncate(`${shortPath(path)}${branch}`, 80);
  },
  ExitWorktree: (i) => truncate(str(i.action ?? 'exit'), 40),
  Workflow: (i) => truncate(str(i.name ?? i.action ?? ''), 80),

  // ── todos / memory / journaling ───────────────────────────────────
  TodoWrite: (i) => {
    const n = Array.isArray(i.todos) ? i.todos.length : 0;
    return n > 0 ? `${n} todo${n === 1 ? '' : 's'}` : '(update todos)';
  },
  Todo: (i) => {
    const n = Array.isArray(i.todos) ? i.todos.length : 0;
    return n > 0 ? `${n} todo${n === 1 ? '' : 's'}` : '(update todos)';
  },
  Memory: (i) => truncate(str(i.operation ?? i.key ?? ''), 60),
  Remember: (i) => truncate(firstLine(str(i.content ?? i.text ?? '')), 80),
  Recall: (i) => truncate(str(i.query ?? i.key ?? ''), 60),
  Journal: (i) => truncate(firstLine(str(i.entry ?? i.content ?? '')), 80),

  // ── skills / MCP / providers ──────────────────────────────────────
  Skill: (i) => truncate(str(i.skill ?? i.name ?? ''), 60),
  DiscoverSkills: () => '(discover skills)',
  ListMcpResourcesTool: (i) => truncate(str(i.server ?? '(all)'), 60),
  ReadMcpResourceTool: (i) => {
    const server = str(i.server ?? '');
    const uri = str(i.uri ?? '');
    return truncate(`${server}:${uri}`, 80);
  },
  McpAuth: (i) => truncate(str(i.server ?? i.action ?? ''), 60),
  mcp: (i) => truncate(str(i.name ?? i.method ?? ''), 60),
  Provider: (i) => truncate(str(i.name ?? i.action ?? ''), 60),
  ToolSearch: (i) => truncate(str(i.query ?? ''), 80),
  Config: (i) => truncate(str(i.operation ?? i.key ?? ''), 60),

  // ── user / communication ──────────────────────────────────────────
  AskUserQuestion: (i) => truncate(str(i.label ?? i.question ?? ''), 80),
  SendMessage: (i) => truncate(str(i.type ?? 'message'), 40),
  SendUserMessage: (i) => truncate(firstLine(str(i.message ?? '')), 80),

  // ── serving / pods / sandbox ──────────────────────────────────────
  Serve: (i) => {
    const port = num(i.port);
    const mode = str(i.mode ?? '');
    return truncate(`${mode}${port ? `:${port}` : ''}`, 60);
  },
  StopServe: (i) => truncate(str(i.id ?? i.action ?? 'stop'), 40),
  TailServeLog: (i) => truncate(str(i.action ?? i.id ?? ''), 40),
  Pod: (i) => truncate(str(i.action ?? i.name ?? ''), 60),
  Sandbox: (i) => truncate(str(i.action ?? ''), 60),

  // ── testing / bench / lint ────────────────────────────────────────
  TestRun: (i) => truncate(str(i.suite ?? i.pattern ?? 'tests'), 80),
  Bench: (i) => {
    const cmd = str(i.cmd ?? '');
    const iter = num(i.iterations);
    return truncate(`${cmd}${iter ? ` ×${iter}` : ''}`, 80);
  },
  Lint: (i) => truncate(str(i.path ?? i.paths ?? '(lint)'), 80),
  Hypothesis: (i) => truncate(firstLine(str(i.hypothesis ?? i.description ?? '')), 80),
  VerifyPlanExecution: (i) => truncate(str(i.plan ?? i.description ?? ''), 80),

  // ── team / scheduling ─────────────────────────────────────────────
  TeamCreate: (i) => truncate(str(i.team_name ?? ''), 60),
  TeamDelete: (i) => truncate(str(i.team_name ?? i.team_id ?? ''), 60),
  ScheduleCron: (i) => truncate(str(i.schedule ?? i.cron ?? ''), 60),
  RemoteTrigger: (i) => truncate(str(i.action ?? i.trigger_id ?? ''), 60),
  Loop: (i) => truncate(str(i.prompt ?? i.command ?? ''), 80),
  Monitor: (i) => truncate(str(i.shell_id ?? i.id ?? ''), 60),
  Sleep: (i) => {
    const ms = num(i.ms ?? i.milliseconds);
    return ms != null ? `${ms}ms` : '';
  },

  // ── utilities ─────────────────────────────────────────────────────
  Compact: () => '(compact context)',
  Snapshot: (i) => truncate(str(i.name ?? i.label ?? ''), 60),
  Scaffold: (i) => truncate(str(i.name ?? i.template ?? ''), 60),
  Synthesize: (i) => truncate(str(i.prompt ?? i.description ?? ''), 80),
  SynthesizeTool: (i) => truncate(str(i.prompt ?? i.description ?? ''), 80),
  StructuredOutput: (i) => truncate(str(i.schema ?? i.format ?? ''), 60),
  Budget: (i) => truncate(str(i.operation ?? ''), 60),
  Bucket: (i) => truncate(str(i.operation ?? i.key ?? ''), 60),
  Brief: (i) => truncate(firstLine(str(i.message ?? '')), 80),
  OAT: (i) => truncate(str(i.model ?? ''), 60),
  Tungsten: (i) => truncate(str(i.action ?? ''), 60),
  TerminalCapture: () => '(capture terminal)',
  ReviewArtifact: (i) => truncate(str(i.artifact ?? i.path ?? ''), 80),
  Snip: (i) => truncate(firstLine(str(i.content ?? '')), 80),
  OverflowTest: () => '(overflow test)',
};

/**
 * Render the one-line input summary for a tool use card. Returns the
 * summary string (without the tool-name prefix). Empty string if the
 * tool is unknown, its renderer throws, or the input is missing —
 * callers should fall back to rendering just the tool name + an
 * expandable raw-JSON body in that case.
 *
 * MCP fallback: tool names matching `mcp__<server>__<op>` pull out the
 * trailing op as a quick summary so the user sees what MCP tool fired
 * without having to read the raw payload.
 */
export function renderToolInputSummary(
  toolName: string,
  input: Record<string, unknown> | undefined,
): string {
  if (!input) return '';
  const renderer = renderers[toolName];
  if (renderer) {
    try {
      return renderer(input);
    } catch {
      return '';
    }
  }
  // MCP wire name: `mcp__<server>__<op>` — surface the op fragment.
  const mcpMatch = toolName.match(/^mcp__([^_]+)__(.+)$/);
  if (mcpMatch) {
    return truncate(`${mcpMatch[1]}/${mcpMatch[2]}`, 60);
  }
  return '';
}
