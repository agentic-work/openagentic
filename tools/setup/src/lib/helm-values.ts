/**
 * Maps a finished WizardConfig → the Helm values object the `helm/openagentic`
 * chart consumes. This is the Helm-side mirror of steps/Launch.tsx `toEnv()`
 * (which writes the Docker `.env`): same provider matrix, same MCP gating, same
 * admin/secret material — just shaped as chart values instead of env vars.
 *
 * The emitted object is fed to helm verbatim as a JSON values file (`helm -f
 * values.json …` — helm reads JSON, a strict YAML subset, by extension). Any env
 * the chart's structured values don't model (the one-shot MAGIC_BOOT_TOKEN, the
 * Vertex AI / Azure AI Foundry provider + embedding env) is appended through the
 * additive `extraEnv` list the api Deployment renders.
 *
 * Value shape is pinned to helm/openagentic/values.yaml — top-level keys:
 *   image, secrets, ollama, bootstrapProvider, milvus, mcps, ingress,
 *   extraEnv, nodeSelector (+ the chart's own resources/securityContext defaults
 *   which the wizard leaves at their chart defaults).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MCPS } from './mcps.ts';
import type { WizardConfig } from './types.ts';

// Embeddings stay on the in-cluster Ollama nomic-embed-text (768) for the
// cloud-chat strategies — the dimension the halfvec columns + Milvus collections
// are built at, and the only key-free embedding path that boots healthy. Mirrors
// the same constants in steps/Launch.tsx.
const BOOTSTRAP_EMBED_MODEL = 'nomic-embed-text';
const BOOTSTRAP_EMBED_DIM = 768;
const OLLAMA_CHAT_MODEL = 'gpt-oss:20b';
const BOOTSTRAP_SEEDER_VERSION = 6;
// Proven-good Vertex defaults (mirror install.sh --vertex / Launch.tsx): chat
// gemini-2.5-flash, embedding gemini-embedding-001 @768, image imagen-4.0-fast.
const VERTEX_EMBED_MODEL = 'gemini-embedding-001';
const VERTEX_EMBED_DIM = 768;
const VERTEX_CHAT_MODEL = 'gemini-2.5-flash';
const VERTEX_IMAGE_MODEL = 'imagen-4.0-fast-generate-001';
// In-container path the SA key would be mounted to; Vertex `sajson` auth is not
// wired into the chart (no host bind-mount in k8s), so we surface it as a clear
// unmapped warning rather than silently dropping it.
const VERTEX_SA_KEY_CONTAINER_PATH = '/var/secrets/gcp/key.json';

export interface HelmEnvEntry { name: string; value: string; }

export interface HelmValues {
  image: { registry: string; tag: string; pullPolicy: string };
  secrets: {
    postgresPassword: string;
    jwtSecret: string;
    signingSecret: string;
    internalApiKey: string;
    frontendSecret: string;
    localEncryptionKey: string;
    adminEmail: string;
    adminPassword: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    awsRegion?: string;
  };
  ollama: {
    enabled: boolean;
    embedModel: string;
    chatModel: string;
    chatHost: string;
    gpu: boolean;
  };
  bootstrapProvider: {
    enabled: boolean;
    name: string;
    displayName: string;
    type: string;
    chatModel: string;
    seederVersion: number;
  };
  milvus: { enabled: boolean };
  mcps: {
    enabled: string;
    kubernetes: { enabled: boolean };
    prometheus: { enabled: boolean; url: string };
    loki: { enabled: boolean; url: string };
    // Cloud + github MCPs. The chart gates each behind its own toggle; gcp
    // additionally reads projectId/region (passed to the mcp-proxy subprocess).
    gcp: { enabled: boolean; projectId: string; region: string };
    aws: { enabled: boolean };
    azure: { enabled: boolean };
    github: { enabled: boolean };
  };
  prometheus: { enabled: boolean };
  loki: { enabled: boolean };
  // Application Default Credentials (ADC) Secret for the Google Vertex provider +
  // the gcp MCP. When enabled the chart mounts the named Secret into the api (at
  // $HOME/.config/gcloud) and the mcp-proxy. install.sh creates the Secret
  // (`kubectl create secret generic gcp-adc …`) before `helm upgrade`.
  adcSecret?: { enabled: boolean; secretName: string };
  ingress: {
    enabled: boolean;
    className: string;
    host: string;
    tlsSecret: string;
  };
  extraEnv: HelmEnvEntry[];
  /** Additive mcp-proxy env (mirrors extraEnv for the api). The gcp MCP path
   *  injects GCP_PROJECT_ID here so the mcp-proxy subprocess resolves it. */
  mcpProxyExtraEnv: HelmEnvEntry[];
}

/** What the chart cannot cleanly express for this config — surfaced to the user
 *  so a Helm install never silently drops a credential it can't honour. */
export interface MapResult {
  values: HelmValues;
  /** The release secrets (persisted so `helm upgrade` reuses them, never rotates). */
  secrets: PersistedSecrets;
  /** Human-readable notes about anything that could NOT be mapped to the chart. */
  warnings: string[];
}

export interface PersistedSecrets {
  postgresPassword: string;
  jwtSecret: string;
  signingSecret: string;
  internalApiKey: string;
  frontendSecret: string;
  localEncryptionKey: string;
}

const rand = (bytes = 32): string => crypto.randomBytes(bytes).toString('hex');

/** Where the release's generated secrets live, so a `helm upgrade` reuses the
 *  SAME JWT/signing/internal/postgres material instead of rotating it (which
 *  would invalidate every session + lock the api out of its own postgres). */
function secretsPath(): string {
  const home = process.env.OPENAGENTIC_HOME
    ? path.resolve(process.env.OPENAGENTIC_HOME, '..')
    : path.join(os.homedir(), '.openagentic');
  return path.join(home, 'helm-secrets.json');
}

/** Load persisted release secrets if present; otherwise mint a fresh strong set
 *  and persist it. Idempotent across wizard re-runs / helm upgrades. */
export function loadOrCreateSecrets(): PersistedSecrets {
  const p = secretsPath();
  try {
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8')) as Partial<PersistedSecrets>;
      if (parsed.jwtSecret && parsed.postgresPassword) {
        return {
          postgresPassword: parsed.postgresPassword,
          jwtSecret: parsed.jwtSecret,
          signingSecret: parsed.signingSecret || rand(),
          internalApiKey: parsed.internalApiKey || rand(),
          frontendSecret: parsed.frontendSecret || rand(16),
          localEncryptionKey: parsed.localEncryptionKey || rand(),
        };
      }
    }
  } catch { /* fall through to fresh mint */ }

  const fresh: PersistedSecrets = {
    postgresPassword: rand(16),
    jwtSecret: rand(),
    signingSecret: rand(),
    internalApiKey: rand(),
    frontendSecret: rand(16),
    localEncryptionKey: rand(),
  };
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(fresh, null, 2), { mode: 0o600 });
  } catch { /* best-effort persist; the install still proceeds with these values */ }
  return fresh;
}

/**
 * Build the chart values for a finished wizard run. `magicToken` is threaded into
 * the api via extraEnv (MAGIC_BOOT_TOKEN) so /auth/magic auto-login works exactly
 * like the Docker path.
 */
export function configToHelmValues(cfg: WizardConfig, magicToken: string): MapResult {
  const warnings: string[] = [];
  const secrets = loadOrCreateSecrets();
  const extraEnv: HelmEnvEntry[] = [];
  const mcpProxyExtraEnv: HelmEnvEntry[] = [];
  const pushEnv = (name: string, value: string | undefined | null) => {
    if (value !== undefined && value !== null && value !== '') extraEnv.push({ name, value });
  };
  const pushMcpProxyEnv = (name: string, value: string | undefined | null) => {
    if (value !== undefined && value !== null && value !== '') mcpProxyExtraEnv.push({ name, value });
  };
  // ADC Secret wiring for the Vertex(ADC) path. Default disabled → no volume
  // rendered (default chart render unchanged). Set true in the vertex/adc arm so
  // the chart mounts the gcp-adc Secret into api + mcp-proxy; install.sh creates
  // the Secret from ~/.config/gcloud before `helm upgrade` (gated on enabled).
  let adcSecret: HelmValues['adcSecret'] = { enabled: false, secretName: 'gcp-adc' };

  const useOllama = cfg.llmStrategy === 'ollama';
  const useBedrock = cfg.llmStrategy === 'bedrock';
  const useVertex = cfg.llmStrategy === 'vertex';
  const useAif = cfg.llmStrategy === 'aif';
  const useOpenai = cfg.llmStrategy === 'openai';
  const useHf = cfg.llmStrategy === 'huggingface';

  // ── secrets block ──────────────────────────────────────────────────────────
  const secretsBlock: HelmValues['secrets'] = {
    postgresPassword: secrets.postgresPassword,
    jwtSecret: secrets.jwtSecret,
    signingSecret: secrets.signingSecret,
    internalApiKey: secrets.internalApiKey,
    frontendSecret: secrets.frontendSecret,
    localEncryptionKey: secrets.localEncryptionKey,
    adminEmail: cfg.admin.email || 'admin@openagentic.local',
    adminPassword: cfg.admin.password,
  };

  // ── Ollama / bootstrap provider ─────────────────────────────────────────────
  // The in-cluster Ollama ALWAYS serves embeddings for the local strategy; for the
  // cloud strategies it stays up to serve nomic-embed-text (768) unless we route
  // embeddings elsewhere (Vertex). `ollama.enabled` follows whether we want the
  // in-cluster Ollama at all. Mirrors api.yaml's gating.
  const ollamaBlock: HelmValues['ollama'] = {
    enabled: false,
    embedModel: cfg.ollama.embedModel || BOOTSTRAP_EMBED_MODEL,
    chatModel: '',
    chatHost: '',
    gpu: false,
  };

  let bootstrap: HelmValues['bootstrapProvider'] = {
    enabled: false,
    name: 'aws-bedrock',
    displayName: 'AWS Bedrock',
    type: 'aws-bedrock',
    chatModel: 'amazon.nova-pro-v1:0',
    seederVersion: BOOTSTRAP_SEEDER_VERSION,
  };

  // milvus mirrors the Docker default: pgvector-only (off) for a healthy first
  // boot; ON only for Vertex, which exercises the semantic tool index end-to-end.
  let milvusEnabled = false;

  if (useOllama) {
    // In-cluster Ollama serves both chat + embeddings. The chart's api.yaml seeds
    // an ollama-local bootstrap provider when ollama.enabled && !bootstrapProvider.
    ollamaBlock.enabled = true;
    ollamaBlock.chatModel = OLLAMA_CHAT_MODEL;
    // If the user pointed at a remote/host Ollama, route chat there and keep the
    // in-cluster Ollama for embeddings only (chart pulls only the embed model).
    const host = cfg.ollama.host || '';
    if (host && !/(^|\/\/)ollama(:|\/|$)/.test(host)) {
      ollamaBlock.chatHost = host;
    }
  } else if (useBedrock && cfg.providers.bedrock) {
    const b = cfg.providers.bedrock;
    const region = (b.region || 'us-east-1').trim() || 'us-east-1';
    const chatModel = (b.model || '').trim() || 'amazon.nova-pro-v1:0';
    // Embeddings stay on the in-cluster Ollama (nomic-embed-text, 768).
    ollamaBlock.enabled = true;
    ollamaBlock.chatModel = '';        // chat is Bedrock — don't pull a chat model
    ollamaBlock.chatHost = '';
    bootstrap = {
      enabled: true,
      name: 'aws-bedrock',
      displayName: 'AWS Bedrock',
      type: 'aws-bedrock',
      chatModel,
      seederVersion: BOOTSTRAP_SEEDER_VERSION,
    };
    secretsBlock.awsRegion = region;
    if (b.authMode === 'keys' && b.accessKeyId && b.secretAccessKey) {
      secretsBlock.awsAccessKeyId = b.accessKeyId;
      secretsBlock.awsSecretAccessKey = b.secretAccessKey;
    } else {
      // 'awslogin' mode mounts the host ~/.aws default chain in Docker — there is
      // NO host filesystem to mount in k8s, so Bedrock can't resolve creds unless
      // the cluster grants the api pod an IAM role (IRSA / pod identity).
      warnings.push(
        "AWS Bedrock auth is 'awslogin' (host ~/.aws): k8s has no host mount, so the api " +
        "pod must get AWS creds another way — supply IAM keys, or attach an IRSA/pod-identity " +
        'role to the api ServiceAccount. No AWS keys were written to the release.'
      );
    }
  } else if (useVertex && cfg.providers.vertex) {
    const v = cfg.providers.vertex;
    const project = (v.projectId || '').trim();
    const region = (v.location || 'us-central1').trim() || 'us-central1';
    const chatModel = (v.model || '').trim() || VERTEX_CHAT_MODEL;
    // Vertex serves BOTH chat + embeddings. Turn the in-cluster Ollama OFF (no
    // embeddings needed there) and route embeddings through Vertex. pgvector-only
    // (milvus OFF) + SKIP_TOOL_SEMANTIC_CACHE=true — mirrors the proven compose
    // --vertex path (MCP tool embeddings live in the postgres halfvec columns).
    ollamaBlock.enabled = false;
    milvusEnabled = false;
    // The chart's api.yaml has no Vertex env block, so inject the full GoogleVertex
    // chat + GCP_* embedding env via extraEnv (mirrors Launch.toEnv()'s vertex arm).
    pushEnv('GOOGLE_CLOUD_PROJECT', project);
    pushEnv('GOOGLE_CLOUD_LOCATION', region);
    pushEnv('VERTEX_PROJECT', project);
    pushEnv('VERTEX_LOCATION', region);
    pushEnv('VERTEX_CHAT_MODEL', chatModel);
    pushEnv('EMBEDDING_PROVIDER', 'vertex-ai');
    pushEnv('GCP_PROJECT_ID', project);
    pushEnv('GCP_LOCATION', region);
    pushEnv('GCP_EMBEDDING_MODEL', VERTEX_EMBED_MODEL);
    pushEnv('EMBEDDING_DIMENSIONS', String(VERTEX_EMBED_DIM));
    pushEnv('DEFAULT_IMAGE_MODEL', VERTEX_IMAGE_MODEL);
    // pgvector-only — skip the tool semantic cache (matches the proven compose
    // --vertex path). Pushing 'false' would force the Milvus tool index on.
    pushEnv('SKIP_TOOL_SEMANTIC_CACHE', 'true');
    pushEnv('BOOTSTRAP_PROVIDER_NAME', 'google-vertex');
    pushEnv('BOOTSTRAP_PROVIDER_DISPLAY_NAME', 'Google Vertex AI');
    pushEnv('BOOTSTRAP_PROVIDER_TYPE', 'vertex-ai');
    pushEnv('BOOTSTRAP_PROVIDER_CONFIG', JSON.stringify({ projectId: project, location: region }));
    pushEnv('BOOTSTRAP_PROVIDER_DEFAULTS', JSON.stringify({
      chat: chatModel,
      embedding: VERTEX_EMBED_MODEL,
      embeddingDimension: VERTEX_EMBED_DIM,
    }));
    pushEnv('SEEDER_VERSION', String(BOOTSTRAP_SEEDER_VERSION));
    if (v.authMode === 'sajson' && v.saKeyPath) {
      // Docker mounts the SA key from the host; k8s has no equivalent here. The
      // pod would need ADC via Workload Identity / a mounted Secret at
      // VERTEX_SA_KEY_CONTAINER_PATH — neither of which the chart provisions.
      warnings.push(
        `Google Vertex AI auth is 'sajson' (host SA key ${v.saKeyPath}): the chart does not mount ` +
        `a host file into the api pod. Provide ADC via GKE Workload Identity, or add the key as a ` +
        `Secret mounted at ${VERTEX_SA_KEY_CONTAINER_PATH} and set GOOGLE_APPLICATION_CREDENTIALS. ` +
        'Chat/embeddings will fail to authenticate until then.'
      );
    } else if (v.authMode === 'adc') {
      // ADC (host `gcloud auth application-default login`): wire the chart's
      // adcSecret so the api + mcp-proxy mount the user ADC at $HOME/.config/gcloud.
      // install.sh creates the gcp-adc Secret from
      // ~/.config/gcloud/application_default_credentials.json before `helm upgrade`.
      // Do NOT set GOOGLE_APPLICATION_CREDENTIALS — the ADC is a USER credential
      // (authorized_user); GoogleVertexProvider rejects it as a non-SA JSON. The
      // @google/genai SDK discovers the well-known ADC path automatically.
      adcSecret = { enabled: true, secretName: 'gcp-adc' };
      warnings.push(
        "Google Vertex AI auth is 'adc' — the chart will mount the 'gcp-adc' Secret into the api + " +
        'mcp-proxy. install.sh creates it from ~/.config/gcloud/application_default_credentials.json ' +
        'before the helm upgrade. (For a non-install.sh helm run, create it yourself: ' +
        'kubectl -n <ns> create secret generic gcp-adc --from-file=' +
        'application_default_credentials.json=$HOME/.config/gcloud/application_default_credentials.json.)'
      );
    }
  } else if (useAif && cfg.providers.azureFoundry) {
    const a = cfg.providers.azureFoundry;
    const endpointUrl = (a.endpointUrl || '').trim();
    const apiVersion = (a.apiVersion || '').trim() || '2024-10-21';
    const deploymentName = (a.deploymentName || '').trim();
    // Embeddings stay on the in-cluster Ollama (nomic-embed-text, 768).
    ollamaBlock.enabled = true;
    ollamaBlock.chatModel = '';
    ollamaBlock.chatHost = '';
    pushEnv('AIF_ENDPOINT_URL', endpointUrl);
    pushEnv('AIF_API_VERSION', apiVersion);
    pushEnv('AIF_MODEL', deploymentName);
    if (a.authMode === 'apikey' && a.apiKey) {
      pushEnv('AIF_API_KEY', a.apiKey);
    } else if (a.authMode === 'entra') {
      pushEnv('AIF_TENANT_ID', a.tenantId);
      pushEnv('AIF_CLIENT_ID', a.clientId);
      pushEnv('AIF_CLIENT_SECRET', a.clientSecret);
    } else if (a.authMode === 'azlogin') {
      warnings.push(
        "Azure AI Foundry auth is 'azlogin' (host ~/.azure): k8s has no host mount. The api pod " +
        'needs Azure creds via Workload Identity or an Entra app (tenant/client/secret). ' +
        'No Azure credential was written to the release.'
      );
    }
    const aifConfig: Record<string, string> = { endpointUrl, apiVersion, deploymentName };
    if (a.authMode === 'entra') {
      if (a.tenantId) aifConfig.tenantId = a.tenantId;
      if (a.clientId) aifConfig.clientId = a.clientId;
    }
    pushEnv('BOOTSTRAP_PROVIDER_NAME', 'azure-ai-foundry');
    pushEnv('BOOTSTRAP_PROVIDER_DISPLAY_NAME', 'Azure AI Foundry');
    pushEnv('BOOTSTRAP_PROVIDER_TYPE', 'azure-ai-foundry');
    pushEnv('BOOTSTRAP_PROVIDER_CONFIG', JSON.stringify(aifConfig));
    pushEnv('BOOTSTRAP_PROVIDER_DEFAULTS', JSON.stringify({
      chat: deploymentName,
      embedding: BOOTSTRAP_EMBED_MODEL,
      embeddingDimension: BOOTSTRAP_EMBED_DIM,
    }));
    pushEnv('SEEDER_VERSION', String(BOOTSTRAP_SEEDER_VERSION));
  } else if (useOpenai && cfg.providers.openai) {
    const o = cfg.providers.openai;
    const chatModel = (o.model || '').trim() || 'gpt-4o-mini';
    // Embeddings stay on the in-cluster Ollama (nomic-embed-text, 768).
    ollamaBlock.enabled = true;
    ollamaBlock.chatModel = '';
    ollamaBlock.chatHost = '';
    pushEnv('OPENAI_API_KEY', o.apiKey);
    pushEnv('BOOTSTRAP_PROVIDER_NAME', 'openai');
    pushEnv('BOOTSTRAP_PROVIDER_DISPLAY_NAME', 'OpenAI');
    pushEnv('BOOTSTRAP_PROVIDER_TYPE', 'openai');
    pushEnv('BOOTSTRAP_PROVIDER_CONFIG', JSON.stringify({ baseUrl: 'https://api.openai.com/v1' }));
    pushEnv('BOOTSTRAP_PROVIDER_DEFAULTS', JSON.stringify({
      chat: chatModel,
      embedding: BOOTSTRAP_EMBED_MODEL,
      embeddingDimension: BOOTSTRAP_EMBED_DIM,
    }));
    pushEnv('SEEDER_VERSION', String(BOOTSTRAP_SEEDER_VERSION));
  } else if (useHf && cfg.providers.huggingface) {
    const h = cfg.providers.huggingface;
    const baseUrl = (h.endpointUrl || '').trim().replace(/\/+$/, '');
    const chatModel = (h.model || '').trim();
    // Embeddings stay on the in-cluster Ollama (nomic-embed-text, 768).
    ollamaBlock.enabled = true;
    ollamaBlock.chatModel = '';
    ollamaBlock.chatHost = '';
    // OpenAI-compatible: the HF token is the OpenAI bearer; the base URL is carried
    // in BOOTSTRAP_PROVIDER_CONFIG.baseUrl (and OPENAI_BASE_URL for re-detection).
    pushEnv('OPENAI_API_KEY', h.token);
    pushEnv('OPENAI_BASE_URL', baseUrl);
    pushEnv('BOOTSTRAP_PROVIDER_NAME', 'huggingface');
    pushEnv('BOOTSTRAP_PROVIDER_DISPLAY_NAME', 'Hugging Face');
    pushEnv('BOOTSTRAP_PROVIDER_TYPE', 'openai');
    pushEnv('BOOTSTRAP_PROVIDER_CONFIG', JSON.stringify({ baseUrl }));
    pushEnv('BOOTSTRAP_PROVIDER_DEFAULTS', JSON.stringify({
      chat: chatModel,
      embedding: BOOTSTRAP_EMBED_MODEL,
      embeddingDimension: BOOTSTRAP_EMBED_DIM,
    }));
    pushEnv('SEEDER_VERSION', String(BOOTSTRAP_SEEDER_VERSION));
  } else {
    // 'skip' / 'none' — no provider seeded. Keep the in-cluster Ollama up to serve
    // embeddings so the api boots healthy and the admin UI can wire a provider.
    ollamaBlock.enabled = true;
    ollamaBlock.chatModel = '';
    ollamaBlock.chatHost = '';
  }

  // ── MCP gating ──────────────────────────────────────────────────────────────
  // The chart reads mcps.enabled (the comma-string) + the per-MCP structured
  // toggles. kubernetes/prometheus/loki have real chart switches and need no
  // creds. The gcp MCP CAN now be wired in the Helm path: when adcSecret is on
  // (the Vertex/ADC arm above), the chart mounts the user ADC into the mcp-proxy
  // so the gcp MCP subprocess authenticates as that identity — so we flip its
  // toggle on and pass GCP_PROJECT_ID (=the vertex project) via mcpProxyExtraEnv.
  // aws/azure/github still have no credential plumbing here, so they stay off.
  const enabled = new Set(cfg.mcps);
  const gcpMcpWired = enabled.has('gcp') && adcSecret.enabled;
  const gcpProject =
    useVertex && cfg.providers.vertex ? (cfg.providers.vertex.projectId || '').trim() : '';
  const gcpRegion =
    useVertex && cfg.providers.vertex
      ? ((cfg.providers.vertex.location || 'us-central1').trim() || 'us-central1')
      : 'us-central1';
  const mcpsBlock: HelmValues['mcps'] = {
    enabled: cfg.mcps.join(','),
    kubernetes: { enabled: enabled.has('kubernetes') },
    prometheus: { enabled: enabled.has('prometheus'), url: 'http://prometheus:9090' },
    loki: { enabled: enabled.has('loki'), url: 'http://loki:3100' },
    gcp: { enabled: gcpMcpWired, projectId: gcpProject, region: gcpRegion },
    aws: { enabled: false },
    azure: { enabled: false },
    github: { enabled: false },
  };
  if (gcpMcpWired) {
    // mcp-proxy reads GCP_PROJECT_ID for the gcp MCP subprocess. The chart already
    // templates it from mcps.gcp.projectId, but also pass it via mcpProxyExtraEnv
    // so it is set even if the structured value is blank (gcloud's active project
    // is the SDK fallback). region mirrors the vertex location.
    pushMcpProxyEnv('GCP_PROJECT_ID', gcpProject);
    pushMcpProxyEnv('GCP_REGION', gcpRegion);
  }

  // Cloud / github MCPs the user enabled but the chart can't wire creds for.
  // gcp is EXCLUDED when it's actually wired (gcpMcpWired) — the ADC mount gives
  // it an identity, so it really does spawn in the Helm path.
  const unmappableMcps = MCPS.filter(
    (m) =>
      enabled.has(m.id) &&
      (m.needsAuth && !m.bundledBackend) &&
      m.id !== 'kubernetes' &&
      !(m.id === 'gcp' && gcpMcpWired),
  ).map((m) => m.id);
  if (unmappableMcps.length) {
    warnings.push(
      `MCPs [${unmappableMcps.join(', ')}] were selected but the chart's mcp-proxy hardcodes them ` +
      'disabled (no credential plumbing in the Helm path). They will not spawn. The in-cluster ' +
      'kubernetes/prometheus/loki MCPs need no creds and ARE wired' +
      (gcpMcpWired ? '; the gcp MCP is wired via the mounted ADC identity.' : '.')
    );
  }
  // Any inline MCP auth fields the user typed can't be injected via the chart.
  const inlineAuthKeys = Object.keys(cfg.mcpAuth).filter((k) => !k.startsWith('__skip_') && cfg.mcpAuth[k]);
  if (inlineAuthKeys.length) {
    warnings.push(
      `Inline MCP credentials (${inlineAuthKeys.join(', ')}) are not mapped — the Helm chart has no ` +
      'per-MCP credential Secret for these. Add them to the release via your own values overlay if needed.'
    );
  }

  // ── magic-link auto-login ────────────────────────────────────────────────────
  pushEnv('MAGIC_BOOT_TOKEN', magicToken);

  const values: HelmValues = {
    // Always re-pull: :latest is mutable, so IfNotPresent would serve a stale
    // cached image on every redeploy/update. Always guarantees the current build.
    image: { registry: 'ghcr.io/agentic-work', tag: 'latest', pullPolicy: 'Always' },
    secrets: secretsBlock,
    ollama: ollamaBlock,
    bootstrapProvider: bootstrap,
    milvus: { enabled: milvusEnabled },
    mcps: mcpsBlock,
    // Monitoring backends follow the picked MCPs (mirrors the Docker `monitoring`
    // profile auto-wire). Prometheus also backs the admin dashboard, so keep it on.
    prometheus: { enabled: true },
    loki: { enabled: enabled.has('loki') },
    adcSecret,
    ingress: { enabled: false, className: 'nginx', host: 'openagentic.local', tlsSecret: '' },
    extraEnv,
    mcpProxyExtraEnv,
  };

  return { values, secrets, warnings };
}
