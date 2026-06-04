export type DeployTarget = 'docker' | 'helm';
/** See steps/LlmStrategy.tsx for the user-facing copy. */
export type LlmStrategy = 'ollama' | 'cloud' | 'both' | 'skip';

export interface WizardConfig {
  target: DeployTarget;
  /** Chosen in the LLM-strategy step. Gates whether OLLAMA_* and the
   *  cloud-LLM API-key envs get written. */
  llmStrategy: LlmStrategy;
  admin: {
    email: string;
    password: string;
    name: string;
  };
  ollama: {
    host: string;                 // e.g. http://localhost:11434
    embedModel: string;           // default: nomic-embed-text (Ollama is embeddings-only now)
  };
  providers: {
    /**
     * The only cloud-LLM option the wizard offers. Cloud LLMs authenticate
     * via AWS IAM ONLY — no raw provider API keys (firm product decision;
     * Ollama is the sole key-free local exception). When set, the wizard
     * seeds an `aws-bedrock` bootstrap provider with claude-sonnet-4-6 as
     * the default chat (and therefore flows) model.
     *
     *   region        — AWS region, default us-east-1 (required).
     *   useHostCreds   — mount + read the user's host ~/.aws creds.
     *   profile        — a named AWS profile (also needs the ~/.aws mount).
     *   accessKeyId /
     *   secretAccessKey— inline IAM keys (no mount required).
     */
    awsBedrock?: {
      region: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      profile?: string;
      useHostCreds?: boolean;
    };
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
  llmStrategy: 'both',
  admin: {
    email: 'admin@openagentic.local',
    password: '',
    name: 'Admin',
  },
  ollama: {
    // The bundled compose `ollama` service (ollama-init pre-pulls the embed
    // model into it). This is the turnkey default and works on every platform.
    // Point at http://host.docker.internal:11434 instead only if you run Ollama
    // on the host (e.g. macOS Metal GPU) rather than the bundled container.
    host: 'http://ollama:11434',
    embedModel: 'nomic-embed-text',
  },
  providers: {},
  mcps: [],          // populated from defaultEnabledMcps() in the MCP step
  mcpAuth: {},
  uiPort: 8080,
};
