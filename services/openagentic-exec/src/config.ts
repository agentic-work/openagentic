export interface Config {
  port: number;
  claudePath: string;
  claudeHome: string;
  workspacesPath: string;
  internalApiKey: string;
  apiEndpoint: string;
  sandboxEnabled: boolean;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.PORT || '3060', 10),
    claudePath: process.env.CLAUDE_PATH || '/usr/local/bin/claude',
    // claude's own HOME (where it's installed + stores config), distinct from the
    // per-session workspace (the cwd). Keeping HOME here means ~/.local/bin (the
    // native claude install) resolves in PATH and config is written once.
    claudeHome: process.env.CLAUDE_HOME || '/home/claudeuser',
    workspacesPath: process.env.WORKSPACES_PATH || '/workspaces',
    internalApiKey: process.env.INTERNAL_API_KEY || '',
    apiEndpoint: process.env.OPENAGENTIC_API_ENDPOINT || 'http://api:8000',
    sandboxEnabled: process.env.SANDBOX_ENABLED !== 'false',
  };
}

