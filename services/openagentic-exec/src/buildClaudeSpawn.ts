export interface ClaudeSpawnInput {
  claudePath: string; workspacePath: string; apiEndpoint: string;
  authToken: string; model: string; home: string;
}
export interface ClaudeSpawn { command: string; args: string[]; cwd: string; env: Record<string,string>; }
export function buildClaudeSpawn(i: ClaudeSpawnInput): ClaudeSpawn {
  const env: Record<string,string> = {
    ...process.env as Record<string,string>,
    HOME: i.home,
    ANTHROPIC_BASE_URL: i.apiEndpoint,
    ANTHROPIC_AUTH_TOKEN: i.authToken,
  };
  if (i.model) env.ANTHROPIC_MODEL = i.model;
  // --dangerously-skip-permissions: bypass the first-run "trust this folder"
  // dialog and per-tool permission prompts so the PTY never blocks waiting for
  // interactive confirmation. Safe here: the exec runs as a non-root user in an
  // isolated container, operating only on the user's own per-session workspace.
  return { command: i.claudePath, args: ['--dangerously-skip-permissions'], cwd: i.workspacePath, env };
}
