export type DeployTarget = 'docker' | 'helm';

export interface WizardConfig {
  target: DeployTarget;
  admin: {
    email: string;
    password: string;
    name: string;
  };
  ollama: {
    host: string;                 // e.g. http://hal.gnomuslabs.com:11434
    embedModel: string;           // default: nomic-embed-text
    chatModel?: string;           // optional — pre-selects a chat model
  };
  providers: {
    anthropic?: string;
    openai?: string;
    google?: string;
    azureOpenAIEndpoint?: string;
    azureOpenAIKey?: string;
  };
  /** MCPs the user chose to enable. Used as compose profiles + MCPS_ENABLED. */
  mcps: string[];
  /** Per-MCP inline auth values keyed by env var name (merged into .env at launch). */
  mcpAuth: Record<string, string>;
  uiPort: number;
  /** Helm path only: resolved kubeconfig path used for cluster probe. */
  kubeconfigPath?: string;
}

export const DEFAULT_CONFIG: WizardConfig = {
  target: 'docker',
  admin: {
    email: 'admin@openagentic.local',
    password: '',
    name: 'Admin',
  },
  ollama: {
    host: 'http://host.docker.internal:11434',
    embedModel: 'nomic-embed-text',
  },
  providers: {},
  mcps: [],          // populated from defaultEnabledMcps() in the MCP step
  mcpAuth: {},
  uiPort: 8080,
};
