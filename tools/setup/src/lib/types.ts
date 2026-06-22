export type DeployTarget = 'docker' | 'helm';
/** See steps/LlmStrategy.tsx for the user-facing copy.
 *  `'none'` is the un-chosen sentinel: it is the default in DEFAULT_CONFIG and
 *  the highlighted first row in the LLM-strategy menu, so NO real provider is
 *  ever pre-selected. The user must explicitly move to and pick a provider —
 *  the platform never defaults to, forces, or pushes one (least of all Ollama).
 *  Selecting the sentinel is a no-op (the menu just re-prompts). */
export type LlmStrategy = 'none' | 'ollama' | 'cloud' | 'vertex' | 'both' | 'skip';

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
    /**
     * Google Vertex AI — the GCP-native cloud option, chosen via LlmStrategy
     * 'vertex'. Authenticates with a service-account key (workload identity /
     * ADC) — no API keys. Seeds a `vertex-ai` bootstrap provider with
     * gemini-2.5-pro as the default chat model AND routes embeddings + image
     * through Vertex (text-embedding-005 / Imagen). The SA key is mounted into
     * the api read-only; GOOGLE_APPLICATION_CREDENTIALS points at it.
     */
    vertex?: {
      project: string;        // GCP project id (required)
      region: string;         // Vertex region, default us-central1
      chatModel: string;      // default gemini-2.5-pro
      embedModel: string;     // default text-embedding-005 (768-dim)
      imageModel: string;     // default imagen-4.0-generate-001
      saKeyPath: string;      // host path to a GCP service-account key JSON
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
  // No provider is chosen until the user explicitly picks one in the LLM-strategy
  // step. The platform NEVER defaults to / forces / pushes a provider (Ollama
  // included). 'none' is the un-chosen sentinel; the strategy step blocks until
  // a real provider (or an explicit "skip / configure later") is selected.
  llmStrategy: 'none',
  admin: {
    email: 'admin@openagentic.local',
    password: '',
    name: 'Admin',
  },
  ollama: {
    // ONLY used when the user explicitly chooses an Ollama strategy. The bundled
    // compose `ollama` service (started by the `ollama` profile) serves this
    // endpoint; point at http://host.docker.internal:11434 instead to reach an
    // Ollama you already run on the host. Never written to .env unless Ollama
    // is the chosen provider.
    host: 'http://ollama:11434',
    embedModel: 'nomic-embed-text',
  },
  providers: {},
  mcps: [],          // populated from defaultEnabledMcps() in the MCP step
  mcpAuth: {},
  uiPort: 8080,
};
