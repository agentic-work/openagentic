export interface Config {
  port: number;
  claudePath: string;
  workspacesPath: string;
  internalApiKey: string;
  apiEndpoint: string;
  sandboxEnabled: boolean;
}

export function loadConfig(): Config {
  return {
    port: parseInt(process.env.PORT || '3060', 10),
    claudePath: process.env.CLAUDE_PATH || '/usr/local/bin/claude',
    workspacesPath: process.env.WORKSPACES_PATH || '/workspaces',
    internalApiKey: process.env.INTERNAL_API_KEY || '',
    apiEndpoint: process.env.OPENAGENTIC_API_ENDPOINT || 'http://api:8000',
    sandboxEnabled: process.env.SANDBOX_ENABLED !== 'false',
  };
}

