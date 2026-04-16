export type DeployTarget = 'docker' | 'helm';

export type CodingAdapterId = 'claude-code' | 'gemini-cli' | 'none';

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
  /** Which coding CLI to bundle as Code Mode's default. Both claude-code
   * and gemini-cli are pre-installed in the exec sandbox. */
  codingAdapter: CodingAdapterId;
  /** MCPs the user chose to enable. Used as compose profiles + MCPS_ENABLED. */
  mcps: string[];
  /** Per-MCP inline auth values keyed by env var name (merged into .env at launch). */
  mcpAuth: Record<string, string>;
  uiPort: number;
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
  codingAdapter: 'claude-code',
  mcps: [],          // populated from defaultEnabledMcps() in the MCP step
  mcpAuth: {},
  uiPort: 8080,
};
