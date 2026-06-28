export type DeployTarget = 'docker' | 'helm';
/** See steps/LlmStrategy.tsx for the user-facing copy.
 *  The wizard offers single-provider choices plus an explicit skip: Ollama
 *  (local), AWS Bedrock, Google Vertex AI, Azure AI Foundry, OpenAI, and
 *  Hugging Face (OpenAI-compatible endpoint).
 *  `'none'` is the un-chosen sentinel: it is the default in DEFAULT_CONFIG and
 *  the highlighted first row in the LLM-strategy menu, so NO real provider is
 *  ever pre-selected. The user must explicitly move to and pick a provider —
 *  the platform never defaults to, forces, or pushes one (least of all Ollama).
 *  Selecting the sentinel is a no-op (the menu just re-prompts). */
export type LlmStrategy = 'none' | 'ollama' | 'bedrock' | 'vertex' | 'aif' | 'openai' | 'huggingface' | 'skip';

export interface WizardConfig {
  target: DeployTarget;
  /** Chosen in the LLM-strategy step. Gates whether OLLAMA_* and the
   *  cloud-LLM provider envs get written. */
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
     * AWS Bedrock — models served via the user's AWS account, chosen via
     * LlmStrategy 'bedrock'. Authenticates EITHER with the host's current AWS
     * login (ambient creds from the mounted ~/.aws — offered only when detected)
     * OR with pregenerated IAM keys. The chat model is user-entered.
     *
     *   authMode       — 'awslogin' (mounted ~/.aws) | 'keys' (inline IAM).
     *   region         — AWS region, default us-east-1 (required).
     *   accessKeyId /
     *   secretAccessKey— inline IAM keys ('keys' mode only).
     *   model          — Bedrock chat model id (e.g. amazon.nova-pro-v1:0).
     */
    bedrock?: {
      authMode: 'awslogin' | 'keys';
      region: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      model: string;
    };
    /**
     * Google Vertex AI — Gemini models via the user's GCP project, chosen via
     * LlmStrategy 'vertex'. Authenticates EITHER with the host's current gcloud
     * login (ADC from the mounted ~/.config/gcloud — offered only when detected)
     * OR with a pregenerated service-account JSON key. The chat model is
     * user-entered (a Gemini model id).
     *
     *   authMode    — 'adc' (mounted ~/.config/gcloud) | 'sajson' (SA key file).
     *   projectId   — GCP project id (required).
     *   location    — Vertex location, default us-central1.
     *   saKeyPath   — host path to a GCP service-account key JSON ('sajson' mode).
     *   model       — Gemini chat model id (e.g. gemini-1.5-pro).
     */
    vertex?: {
      authMode: 'adc' | 'sajson';
      projectId: string;
      location: string;
      saKeyPath?: string;
      model: string;
    };
    /**
     * Azure AI Foundry — models via the user's Azure endpoint, chosen via
     * LlmStrategy 'aif'. Authenticates EITHER with an API key, a Microsoft Entra
     * app (tenant + client + secret), OR the host's current az login
     * (DefaultAzureCredential from the mounted ~/.azure — offered only when
     * detected). The deployment/model name is user-entered.
     *
     *   authMode       — 'apikey' | 'entra' | 'azlogin'.
     *   endpointUrl    — AIF endpoint URL (required).
     *   apiKey         — AIF API key ('apikey' mode).
     *   tenantId /
     *   clientId /
     *   clientSecret   — Entra app credentials ('entra' mode).
     *   apiVersion     — AIF API version, default 2024-10-21.
     *   deploymentName — AIF deployment / model name (required).
     */
    azureFoundry?: {
      authMode: 'apikey' | 'entra' | 'azlogin';
      endpointUrl: string;
      apiKey?: string;
      tenantId?: string;
      clientId?: string;
      clientSecret?: string;
      apiVersion: string;
      deploymentName: string;
    };
    /**
     * OpenAI — models via the official OpenAI API, chosen via LlmStrategy
     * 'openai'. Authenticates with an API key. The chat model is user-entered.
     *
     *   apiKey  — OpenAI API key (required).
     *   model   — OpenAI chat model id (default gpt-4o-mini).
     */
    openai?: {
      apiKey: string;
      model: string;
    };
    /**
     * Hugging Face — a Hugging Face Inference Endpoint / TGI server, chosen via
     * LlmStrategy 'huggingface'. These are OpenAI-compatible, so the platform
     * wires them through the OpenAI adapter with a custom base URL (carried in
     * BOOTSTRAP_PROVIDER_CONFIG.baseUrl). Authenticates with an HF token used as
     * the OpenAI bearer.
     *
     *   endpointUrl — HF Inference Endpoint / TGI base URL, OpenAI-compatible (required).
     *   token       — HF access token (used as the OpenAI bearer; required).
     *   model       — served model name (required).
     */
    huggingface?: {
      endpointUrl: string;
      token: string;
      model: string;
    };
  };
  /** MCPs the user chose to enable. Used as compose profiles + MCPS_ENABLED. */
  mcps: string[];
  /** Per-MCP inline auth values keyed by env var name (merged into .env at launch). */
  mcpAuth: Record<string, string>;
  uiPort: number;
  /** Docker only: skip the UI container and publish the API on the host port so
   *  the platform is driven headlessly via the `oa` CLI. No effect on helm. */
  headless: boolean;
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
  headless: false,
};
