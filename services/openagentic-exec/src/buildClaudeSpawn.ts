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
  // No CLI flags: permission bypass + onboarding skip are handled via config
  // (settings.json `permissions.defaultMode: bypassPermissions` + ~/.claude.json
  // `hasCompletedOnboarding`), which the writeClaudeSettings step writes into the
  // session HOME. The --dangerously-skip-permissions FLAG is intentionally NOT
  // used: it shows a blocking one-time "accept bypass mode" dialog, whereas
  // bypassPermissions-as-default suppresses that dialog entirely.
  return { command: i.claudePath, args: [], cwd: i.workspacePath, env };
}
