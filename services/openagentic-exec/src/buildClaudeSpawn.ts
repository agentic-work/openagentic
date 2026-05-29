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
  return { command: i.claudePath, args: [], cwd: i.workspacePath, env };
}
