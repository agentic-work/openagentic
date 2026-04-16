/**
 * Configuration for Openagentic Exec Daemon
 *
 * This is a lightweight execution service that runs CLI sessions
 * and code-server instances. It's controlled by openagentic-manager.
 */

export interface Config {
  port: number;
  openagenticPath: string;
  workspacesPath: string;
  internalApiKey: string;
  // Sandbox user configuration
  sandboxEnabled: boolean;
  sandboxUidMin: number;
  sandboxUidMax: number;
  // code-server configuration
  codeServerBinary: string;
  codeServerBasePort: number;
  codeServerMaxInstances: number;
  codeServerExtensionsDir: string;
  codeServerUserDataDir: string;
  // Ollama configuration (for local LLM)
  ollamaHost: string;
  defaultModel: string;
  // CLI backend: always openagentic-cli (routes through SDK/API)
  cliBackend: 'openagentic-cli';
  // OpenAgentic API endpoint for fetching codemode admin config
  openagenticApiEndpoint: string;
}

export const config: Config = {
  port: parseInt(process.env.PORT || '3060'),
  openagenticPath: process.env.OPENAGENTIC_PATH || '/usr/local/bin/openagentic',
  workspacesPath: process.env.WORKSPACES_PATH || '/workspaces',
  internalApiKey: process.env.INTERNAL_API_KEY || '',
  // Sandbox
  sandboxEnabled: process.env.SANDBOX_ENABLED !== 'false',
  sandboxUidMin: parseInt(process.env.SANDBOX_UID_MIN || '10000'),
  sandboxUidMax: parseInt(process.env.SANDBOX_UID_MAX || '60000'),
  // code-server
  codeServerBinary: process.env.CODE_SERVER_BINARY || '/usr/bin/code-server',
  codeServerBasePort: parseInt(process.env.CODE_SERVER_BASE_PORT || '3100'),
  codeServerMaxInstances: parseInt(process.env.CODE_SERVER_MAX_INSTANCES || '100'),
  codeServerExtensionsDir: process.env.CODE_SERVER_EXTENSIONS_DIR || '/var/lib/code-server/extensions',
  codeServerUserDataDir: process.env.CODE_SERVER_USER_DATA_DIR || '/var/lib/code-server',
  // Ollama - OLLAMA_HOST is passed by k8sSessionManager, fallback uses K8s service name
  ollamaHost: process.env.OLLAMA_HOST || process.env.OLLAMA_URL || 'http://openagentic-ollama:11434',
  // NEVER hardcode a model. Empty = API smart router decides (admin DB → platform default)
  defaultModel: process.env.DEFAULT_MODEL || '',
  // CLI backend: always openagentic-cli (routes through SDK/API)
  cliBackend: 'openagentic-cli' as const,
  // OpenAgentic API endpoint for fetching codemode admin config (marketplace lock, skills, MCP)
  openagenticApiEndpoint: process.env.OPENAGENTIC_API_ENDPOINT || 'http://openagentic-api:8000',
};
