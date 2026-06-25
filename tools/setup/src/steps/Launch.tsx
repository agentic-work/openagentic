import React, { useEffect, useState } from 'react';
import crypto from 'node:crypto';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import open from 'open';
import { Screen, Hint, COLORS } from '../ui/Theme.tsx';
import { Bar, Rule } from '../ui/effects.tsx';
import { Link } from '../ui/Link.tsx';
import type { WizardConfig } from '../lib/types.ts';
import { writeEnv } from '../lib/env.ts';
import { launchDocker, type StartProgress } from '../backends/docker.ts';
import { launchHelm } from '../backends/helm.ts';
import { MCPS, mcpById } from '../lib/mcps.ts';

interface Props {
  config: WizardConfig;
  step: number;
  total: number;
  onDone: () => void;
}

type TaskState = 'pending' | 'running' | 'ok' | 'fail';
interface Task { label: string; state: TaskState; detail?: string; }

const DRY_RUN = process.env.WIZARD_DRY_RUN === '1';

// The brand sweep for the progress bar — same chord the StepHeader Bar uses.
const BAR_STOPS = ['#6FB3A8', '#9FD8C4', '#88CCA0', '#D9AE52', '#DB8240'];

/** The summary the wizard shows once the stack is healthy. */
interface LaunchResult {
  chatUrl: string;
  magicUrl: string;
  adminEmail: string;
  password?: string;
}

// ── Bootstrap embedding constants ────────────────────────────────────────────
// Embeddings stay on Ollama nomic-embed-text (768) for the cloud-chat
// strategies — the dimension the halfvec columns + Milvus collections are built
// at, and the only key-free embedding path that boots healthy regardless of when
// cloud creds resolve.
const BOOTSTRAP_EMBED_MODEL = 'nomic-embed-text';
const BOOTSTRAP_EMBED_DIM = 768;
// The default local Ollama chat model seeded for the Ollama strategy. Setting
// this also makes ollama-init pre-pull the tag on first boot.
const OLLAMA_CHAT_MODEL = 'gpt-oss:20b';
// Gates RegistryBootstrapSeeder, which only (re)seeds when this value is greater
// than the registry_seeder_version persisted in the DB (default 0 on a fresh
// install) — so any value >0 writes the chat role-assignment row on boot.
const BOOTSTRAP_SEEDER_VERSION = '6';

// ── Google Vertex AI bootstrap constants ─────────────────────────────────────
// Vertex is the GCP-native cloud strategy: a user-entered Gemini chat model +
// text-embedding-005 embeddings (768-dim, the halfvec/Milvus dimension), all
// authenticated with the user's current gcloud login (ADC) or a mounted
// service-account key. The vertex-ai bootstrap provider auto-seeds the chosen
// chat model as role='chat' via LLMProviderSeeder (no admin step), PROVIDED
// ADMIN_USER_EMAIL resolves to a seeded user.
const VERTEX_EMBED_MODEL = 'text-embedding-005';
const VERTEX_EMBED_DIM = 768;
// In-container path the host SA key is mounted to (compose volume); the chat
// provider + embedding service both read GOOGLE_APPLICATION_CREDENTIALS = this.
const VERTEX_SA_KEY_CONTAINER_PATH = '/var/secrets/gcp/key.json';

export const LaunchStep: React.FC<Props> = ({ config, step, total, onDone }) => {
  const [tasks, setTasks] = useState<Task[]>(() => {
    const baseLabels = DRY_RUN
      ? ['Write .env (dry-run)', 'Skip build (dry-run)', 'Skip start (dry-run)', 'Skip health (dry-run)', 'Skip browser (dry-run)']
      : [
          'Write .env',
          config.target === 'docker' ? 'Pull images' : 'Render chart',
          config.target === 'docker' ? 'Start containers' : 'Apply release',
          'Wait for health',
          'Open browser',
        ];
    return baseLabels.map((label) => ({ label, state: 'pending' as const }));
  });
  // Live image-pull progress for the "Pull images" row (which images are
  // downloading vs already cached locally).
  const [pullProgress, setPullProgress] = useState<StartProgress | null>(null);
  // Live container create/start progress for the "Start containers" row.
  const [progress, setProgress] = useState<StartProgress | null>(null);
  // The completion summary; once set we render the final report instead of tasks.
  const [result, setResult] = useState<LaunchResult | null>(null);

  const setTask = (i: number, patch: Partial<Task>) =>
    setTasks((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setTask(0, { state: 'running' });
        // One-shot magic-link boot token. The api validates /auth/magic against
        // MAGIC_BOOT_TOKEN, so it MUST be in .env before the stack comes up — we
        // generate it here and thread it into both .env and the opened URL.
        const magicToken = crypto.randomBytes(24).toString('base64url');
        writeEnv(toEnv(config, magicToken));
        setTask(0, { state: 'ok' });

        if (DRY_RUN) {
          setTask(1, { state: 'ok', detail: 'skipped' });
          setTask(2, { state: 'ok', detail: 'skipped' });
          setTask(3, { state: 'ok', detail: 'skipped' });
          setTask(4, { state: 'ok', detail: 'skipped' });
          setTimeout(onDone, 50);
          return;
        }

        const backend = config.target === 'docker' ? launchDocker : launchHelm;
        const url = await backend(config, {
          onBuild: (msg) => !cancelled && setTask(1, { state: 'running', detail: msg }),
          onBuildProgress: (p) => !cancelled && setPullProgress(p),
          onBuildDone: () => !cancelled && setTask(1, { state: 'ok' }),
          onStart: (msg) => !cancelled && setTask(2, { state: 'running', detail: msg }),
          onStartProgress: (p) => !cancelled && setProgress(p),
          onStartDone: () => !cancelled && setTask(2, { state: 'ok' }),
          onHealth: (msg) => !cancelled && setTask(3, { state: 'running', detail: msg }),
          onHealthDone: () => !cancelled && setTask(3, { state: 'ok' }),
        });

        if (cancelled) return;
        // Open the AUTO-LOGIN magic link rather than the bare page, so the user
        // lands already signed in as the seeded admin.
        const magicUrl = `http://localhost:${config.uiPort || 8080}/auth/magic?token=${magicToken}`;
        setTask(4, { state: 'running', detail: magicUrl });
        try { await open(magicUrl); } catch { /* browser open is best-effort */ }
        setTask(4, { state: 'ok', detail: magicUrl });

        setResult({
          chatUrl: url,
          magicUrl,
          adminEmail: config.admin.email || 'admin@openagentic.local',
          password: config.admin.password || undefined,
        });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setTasks((ts) => ts.map((t) => (t.state === 'running' ? { ...t, state: 'fail', detail: msg } : t)));
      }
    })();
    return () => { cancelled = true; };
  }, [config]);

  if (result) {
    return <CompletionReport result={result} step={step} total={total} onDone={onDone} />;
  }

  return (
    <Screen step={step} total={total} title={DRY_RUN ? 'Bringing up openagentic (dry-run)' : 'Bringing up openagentic'}>
      <Box flexDirection="column">
        {tasks.map((t, i) => {
          // The "Pull images" (index 1) and "Start containers" (index 2) rows each
          // render an animated bar while running — row 1 fed by pull progress, row 2
          // by container start progress.
          const rowProgress =
            config.target === 'docker' && i === 1 ? pullProgress :
            i === 2 ? progress :
            null;
          const showBar = !DRY_RUN && t.state === 'running' && !!rowProgress && rowProgress.total > 0;
          return (
            <Box key={i} flexDirection="column">
              <Box>
                {t.state === 'running' ? (
                  <Text color={COLORS.accent}><Spinner type="dots" /></Text>
                ) : (
                  <Text color={icon(t.state).color}>{icon(t.state).char}</Text>
                )}
                <Text> </Text>
                <Text>{t.label}</Text>
                {showBar ? (
                  <Text color={COLORS.muted}>  {rowProgress!.done}/{rowProgress!.total}{rowProgress!.current ? ` · ${rowProgress!.current}` : ''}</Text>
                ) : t.detail ? (
                  <Text color={COLORS.muted}>  {t.detail.slice(0, 80)}</Text>
                ) : null}
              </Box>
              {showBar ? (
                <Box marginLeft={2}>
                  <Bar value={rowProgress!.done} total={rowProgress!.total} width={36} stops={BAR_STOPS} />
                </Box>
              ) : null}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Hint>
          {DRY_RUN
            ? 'WIZARD_DRY_RUN=1 — only .env is written; no containers are touched.'
            : 'First boot pulls the embedding model and seeds Milvus — give it a couple minutes.'}
        </Hint>
      </Box>
    </Screen>
  );
};

// ── Final report ─────────────────────────────────────────────────────────────
// On-brand completion summary shown once the stack is healthy: where to chat,
// the one-shot auto-login link, admin creds, a few starter prompts, and docs.
// Dismisses after a short pause OR on any keypress.
const DOCS_URL = 'https://www.openagentics.io/docs/';
const STARTER_PROMPTS = [
  'Which pods are crashlooping and why?',
  'Summarize the error logs from the last hour.',
  "What's driving this month's cloud cost spike?",
];

const CompletionReport: React.FC<{ result: LaunchResult; step: number; total: number; onDone: () => void }> = ({
  result,
  step,
  total,
  onDone,
}) => {
  useInput(() => onDone());
  useEffect(() => {
    const t = setTimeout(onDone, 30_000);
    return () => clearTimeout(t);
  }, [onDone]);

  const w = Math.max(44, Math.min((process.stdout.columns || 80) - 6, 88));
  const passwordLine = result.password
    ? `password  ${result.password}`
    : 'password  see ~/.openagentic/admin-credentials.txt';

  return (
    <Screen step={step} total={total} title="openagentic is up">
      <Box flexDirection="column">
        <Box>
          <Text color={COLORS.ok} bold>✓ openagentic is up</Text>
          <Text color={COLORS.muted}>  — the stack is healthy and ready.</Text>
        </Box>
        <Box marginTop={1}><Rule width={w} stops={BAR_STOPS} /></Box>

        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color={COLORS.accent} bold>Chat UI    </Text>
            <Link url={result.chatUrl} text={result.chatUrl} />
          </Box>
          <Box>
            <Text color={COLORS.accent} bold>Sign in    </Text>
            <Link url={result.magicUrl} text="one-shot auto-login link (opens you in, signed in)" />
          </Box>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color={COLORS.faint}>admin login</Text>
          <Box marginLeft={2}><Text color={COLORS.ink}>email     {result.adminEmail}</Text></Box>
          <Box marginLeft={2}><Text color={COLORS.ink}>{passwordLine}</Text></Box>
        </Box>

        <Box marginTop={1} flexDirection="column">
          <Text color={COLORS.faint}>try asking the agent</Text>
          {STARTER_PROMPTS.map((p, i) => (
            <Box key={i} marginLeft={2}>
              <Text color={COLORS.signal}>› </Text>
              <Text color={COLORS.muted}>{p}</Text>
            </Box>
          ))}
        </Box>

        <Box marginTop={1}>
          <Text color={COLORS.faint}>docs  </Text>
          <Link url={DOCS_URL} text={DOCS_URL} />
        </Box>
      </Box>
      <Box marginTop={1}>
        <Hint>Press any key to finish.</Hint>
      </Box>
    </Screen>
  );
};

function icon(s: TaskState): { char: string; color: string } {
  switch (s) {
    case 'ok':      return { char: '✓', color: COLORS.ok };
    case 'fail':    return { char: '✗', color: COLORS.err };
    case 'running': return { char: '◦', color: COLORS.accent };
    default:        return { char: '·', color: COLORS.muted };
  }
}

function toEnv(c: WizardConfig, magicToken?: string): Record<string, string> {
  const useOllama  = c.llmStrategy === 'ollama';
  const useBedrock = c.llmStrategy === 'bedrock';
  const useVertex  = c.llmStrategy === 'vertex';
  const useAif     = c.llmStrategy === 'aif';
  const useOpenai  = c.llmStrategy === 'openai';
  const useHf      = c.llmStrategy === 'huggingface';

  const env: Record<string, string> = {
    ADMIN_USER_EMAIL: c.admin.email,
    ADMIN_SEED_PASSWORD: c.admin.password,
    LOCAL_ADMIN_USERNAME: c.admin.name,
    UI_HOST_PORT: String(c.uiPort),
    MCPS_ENABLED: c.mcps.join(','),
  };

  // One-shot magic-link boot token. The api validates GET /auth/magic?token=…
  // against this, so it must be in .env before the stack boots. The wizard
  // builds the auto-login URL from the SAME token and opens it post-health.
  if (magicToken) env.MAGIC_BOOT_TOKEN = magicToken;

  // Ollama envs only when the user EXPLICITLY chose Ollama. The compose
  // defaults are provider-agnostic (OLLAMA_ENABLED=false, empty
  // BOOTSTRAP_PROVIDER_*), so for any other strategy we leave Ollama fully off —
  // nothing is pushed, no model server is started.
  if (useOllama) {
    env.OLLAMA_HOST = c.ollama.host;
    env.OLLAMA_EMBED_MODEL = c.ollama.embedModel;
    env.OLLAMA_ENABLED = 'true';
    // The api needs an explicit embedding provider now that the compose default
    // is empty.
    env.EMBEDDING_PROVIDER = 'ollama';
    // Seed an Ollama bootstrap provider explicitly. The chat-role row only seeds
    // when a chat model tag is set, so pre-pull + seed gpt-oss:20b for a working
    // out-of-the-box local chat.
    env.OLLAMA_CHAT_MODEL = OLLAMA_CHAT_MODEL;
    env.BOOTSTRAP_PROVIDER_NAME = 'ollama-local';
    env.BOOTSTRAP_PROVIDER_DISPLAY_NAME = 'Ollama (local)';
    env.BOOTSTRAP_PROVIDER_TYPE = 'ollama';
    env.BOOTSTRAP_PROVIDER_CONFIG = JSON.stringify({ endpoint: c.ollama.host });
    env.BOOTSTRAP_PROVIDER_DEFAULTS = JSON.stringify({
      chat: OLLAMA_CHAT_MODEL,
      embedding: c.ollama.embedModel,
      embeddingDimension: BOOTSTRAP_EMBED_DIM,
    });
    env.SEEDER_VERSION = BOOTSTRAP_SEEDER_VERSION;
  } else {
    env.OLLAMA_ENABLED = 'false';
  }

  // AWS Bedrock — models via the user's AWS account. Auth is either the host's
  // current AWS login (mounted ~/.aws default credential chain) or pregenerated
  // IAM keys. The chosen Bedrock model becomes the default chat model, which the
  // smart router uses for chat AND for flows (flow agents use model:'auto' →
  // getDefaultChatModel → the role='chat' row seeded from BOOTSTRAP_PROVIDER_DEFAULTS).
  const bedrock = c.providers.bedrock;
  if (useBedrock && bedrock) {
    const region = (bedrock.region || 'us-east-1').trim() || 'us-east-1';
    const chatModel = (bedrock.model || '').trim() || 'amazon.nova-pro-v1:0';
    env.AWS_REGION = region;

    // keys-mode writes inline IAM creds; awslogin-mode writes nothing secret —
    // the provider resolves creds from the mounted host ~/.aws default chain.
    if (bedrock.authMode === 'keys' && bedrock.accessKeyId && bedrock.secretAccessKey) {
      env.AWS_ACCESS_KEY_ID = bedrock.accessKeyId;
      env.AWS_SECRET_ACCESS_KEY = bedrock.secretAccessKey;
    }

    // Bootstrap provider block — aws-bedrock is the chat bootstrap provider.
    env.BOOTSTRAP_PROVIDER_NAME = 'aws-bedrock';
    env.BOOTSTRAP_PROVIDER_DISPLAY_NAME = 'AWS Bedrock';
    env.BOOTSTRAP_PROVIDER_TYPE = 'aws-bedrock';
    env.BOOTSTRAP_PROVIDER_CONFIG = JSON.stringify({ region });
    env.BOOTSTRAP_PROVIDER_DEFAULTS = JSON.stringify({
      chat: chatModel,
      embedding: BOOTSTRAP_EMBED_MODEL,
      embeddingDimension: BOOTSTRAP_EMBED_DIM,
    });
    env.SEEDER_VERSION = BOOTSTRAP_SEEDER_VERSION;
  }

  // Google Vertex AI — Gemini models via the user's GCP project. Auth is either
  // the host's current gcloud login (ADC) or a mounted service-account JSON key.
  // Seeds a vertex-ai bootstrap provider with the chosen Gemini chat model AND
  // routes embeddings through Vertex. The runtime reads TWO separate env families
  // with no cross-fallback: chat → GOOGLE_CLOUD_*, embeddings → GCP_*.
  const vertex = c.providers.vertex;
  if (useVertex && vertex) {
    const project = (vertex.projectId || '').trim();
    const region = (vertex.location || 'us-central1').trim() || 'us-central1';
    const chatModel = (vertex.model || '').trim() || 'gemini-1.5-pro';
    const embeddingModel = VERTEX_EMBED_MODEL;

    // Chat provider (GoogleVertexProvider reads GOOGLE_CLOUD_PROJECT/LOCATION).
    env.GOOGLE_CLOUD_PROJECT = project;
    env.GOOGLE_CLOUD_LOCATION = region;
    // Mirrored so a re-run of the wizard re-detects the vertex strategy (index.tsx).
    env.VERTEX_PROJECT = project;
    env.VERTEX_LOCATION = region;
    env.VERTEX_CHAT_MODEL = chatModel;

    // Embeddings on Vertex (UniversalEmbeddingService reads the GCP_* family).
    env.EMBEDDING_PROVIDER = 'vertex-ai';
    env.GCP_PROJECT_ID = project;
    env.GCP_LOCATION = region;
    env.GCP_EMBEDDING_MODEL = embeddingModel;
    // MANDATORY: text-embedding-005 isn't in the model→dim table, so without this
    // the service defaults to 1536 and breaks the 768 halfvec/Milvus schema.
    env.EMBEDDING_DIMENSIONS = String(VERTEX_EMBED_DIM);
    // Exercise the semantic tool index on Vertex embeddings at first boot (Milvus
    // is up via the compose profile) so the install proves embeddings end-to-end.
    env.SKIP_TOOL_SEMANTIC_CACHE = 'false';

    // sajson-mode mounts a host SA key (GCP_SA_KEY_FILE feeds the compose volume
    // source; GOOGLE_APPLICATION_CREDENTIALS points the adapter at the in-container
    // path). adc-mode writes no creds env — the mounted ~/.config/gcloud resolves.
    if (vertex.authMode === 'sajson' && vertex.saKeyPath) {
      env.GCP_SA_KEY_FILE = vertex.saKeyPath.startsWith('~')
        ? (process.env.HOME || '') + vertex.saKeyPath.slice(1)
        : vertex.saKeyPath;
      env.GOOGLE_APPLICATION_CREDENTIALS = VERTEX_SA_KEY_CONTAINER_PATH;
    }
    // Never let a stale static key shadow ADC (the adapter prefers a key if set).
    env.VERTEX_AI_API_KEY = '';
    env.GEMINI_API_KEY = '';

    // Bootstrap provider — vertex-ai is the chat bootstrap provider for this
    // strategy. CONFIG keys MUST be projectId/location; DEFAULTS recognizes only
    // chat/embedding/embeddingDimension.
    env.BOOTSTRAP_PROVIDER_NAME = 'google-vertex';
    env.BOOTSTRAP_PROVIDER_DISPLAY_NAME = 'Google Vertex AI';
    env.BOOTSTRAP_PROVIDER_TYPE = 'vertex-ai';
    env.BOOTSTRAP_PROVIDER_CONFIG = JSON.stringify({ projectId: project, location: region });
    env.BOOTSTRAP_PROVIDER_DEFAULTS = JSON.stringify({
      chat: chatModel,
      embedding: embeddingModel,
      embeddingDimension: VERTEX_EMBED_DIM,
    });
    env.SEEDER_VERSION = BOOTSTRAP_SEEDER_VERSION;
  }

  // Azure AI Foundry — models via the user's Azure endpoint. Auth is an API key,
  // a Microsoft Entra app, or the host's current az login (DefaultAzureCredential
  // from the mounted ~/.azure). The deployment / model name becomes the default
  // chat model. Embeddings stay on Ollama nomic-embed-text (768).
  const aif = c.providers.azureFoundry;
  if (useAif && aif) {
    const endpointUrl = (aif.endpointUrl || '').trim();
    const apiVersion = (aif.apiVersion || '').trim() || '2024-10-21';
    const deploymentName = (aif.deploymentName || '').trim();

    env.AIF_ENDPOINT_URL = endpointUrl;
    env.AIF_API_VERSION = apiVersion;
    env.AIF_MODEL = deploymentName;

    // Credential material per auth path. apikey → AIF_API_KEY; entra →
    // AIF_TENANT_ID/CLIENT_ID/CLIENT_SECRET; azlogin → nothing secret (the
    // provider falls back to DefaultAzureCredential off the mounted ~/.azure).
    if (aif.authMode === 'apikey' && aif.apiKey) {
      env.AIF_API_KEY = aif.apiKey;
    } else if (aif.authMode === 'entra') {
      if (aif.tenantId) env.AIF_TENANT_ID = aif.tenantId;
      if (aif.clientId) env.AIF_CLIENT_ID = aif.clientId;
      if (aif.clientSecret) env.AIF_CLIENT_SECRET = aif.clientSecret;
    }

    // Bootstrap provider — azure-ai-foundry is the chat bootstrap provider.
    env.BOOTSTRAP_PROVIDER_NAME = 'azure-ai-foundry';
    env.BOOTSTRAP_PROVIDER_DISPLAY_NAME = 'Azure AI Foundry';
    env.BOOTSTRAP_PROVIDER_TYPE = 'azure-ai-foundry';
    const aifConfig: Record<string, string> = { endpointUrl, apiVersion, deploymentName };
    if (aif.authMode === 'entra') {
      if (aif.tenantId) aifConfig.tenantId = aif.tenantId;
      if (aif.clientId) aifConfig.clientId = aif.clientId;
    }
    env.BOOTSTRAP_PROVIDER_CONFIG = JSON.stringify(aifConfig);
    env.BOOTSTRAP_PROVIDER_DEFAULTS = JSON.stringify({
      chat: deploymentName,
      embedding: BOOTSTRAP_EMBED_MODEL,
      embeddingDimension: BOOTSTRAP_EMBED_DIM,
    });
    env.SEEDER_VERSION = BOOTSTRAP_SEEDER_VERSION;
  }

  // OpenAI — models via the official OpenAI API. The chosen chat model becomes the
  // default. Embeddings stay on Ollama nomic-embed-text (768) — the EMBEDDING_PROVIDER
  // is left empty (compose default) so the api boots healthy regardless of when the
  // key resolves, exactly like the Bedrock / AIF arms.
  const openai = c.providers.openai;
  if (useOpenai && openai) {
    const chatModel = (openai.model || '').trim() || 'gpt-4o-mini';
    if (openai.apiKey) env.OPENAI_API_KEY = openai.apiKey;
    env.BOOTSTRAP_PROVIDER_NAME = 'openai';
    env.BOOTSTRAP_PROVIDER_DISPLAY_NAME = 'OpenAI';
    env.BOOTSTRAP_PROVIDER_TYPE = 'openai';
    // baseUrl carried in CONFIG so the OpenAIProvider points at the official API.
    env.BOOTSTRAP_PROVIDER_CONFIG = JSON.stringify({ baseUrl: 'https://api.openai.com/v1' });
    env.BOOTSTRAP_PROVIDER_DEFAULTS = JSON.stringify({
      chat: chatModel,
      embedding: BOOTSTRAP_EMBED_MODEL,
      embeddingDimension: BOOTSTRAP_EMBED_DIM,
    });
    env.SEEDER_VERSION = BOOTSTRAP_SEEDER_VERSION;
  }

  // Hugging Face — an OpenAI-compatible Inference Endpoint / TGI server. Wired
  // through the OpenAI adapter with a custom base URL carried in
  // BOOTSTRAP_PROVIDER_CONFIG.baseUrl (ProviderConfigService maps authConfig.baseUrl
  // onto the OpenAIProvider). The HF token is the OpenAI bearer (OPENAI_API_KEY).
  // OPENAI_BASE_URL is also written so a wizard re-run re-detects the HF strategy.
  const hf = c.providers.huggingface;
  if (useHf && hf) {
    const baseUrl = (hf.endpointUrl || '').trim().replace(/\/+$/, '');
    const chatModel = (hf.model || '').trim();
    if (hf.token) env.OPENAI_API_KEY = hf.token;
    if (baseUrl) env.OPENAI_BASE_URL = baseUrl;
    env.BOOTSTRAP_PROVIDER_NAME = 'huggingface';
    env.BOOTSTRAP_PROVIDER_DISPLAY_NAME = 'Hugging Face';
    env.BOOTSTRAP_PROVIDER_TYPE = 'openai';
    env.BOOTSTRAP_PROVIDER_CONFIG = JSON.stringify({ baseUrl });
    env.BOOTSTRAP_PROVIDER_DEFAULTS = JSON.stringify({
      chat: chatModel,
      embedding: BOOTSTRAP_EMBED_MODEL,
      embeddingDimension: BOOTSTRAP_EMBED_DIM,
    });
    env.SEEDER_VERSION = BOOTSTRAP_SEEDER_VERSION;
  }

  // Per-MCP gating: flip the proxy's *_DISABLED var for anything NOT selected.
  // Selected ones get the env explicitly set to "false" so re-running the
  // wizard and un-disabling clears any stale "true" from a prior run.
  const enabled = new Set(c.mcps);
  for (const mcp of MCPS) {
    env[mcp.disabledEnv] = enabled.has(mcp.id) ? 'false' : 'true';
  }

  // In-stack monitoring backends. Picking the prometheus or loki MCP installs +
  // auto-wires the bundled compose `monitoring` profile (prometheus + loki +
  // promtail + otel-collector). The wizard never prompts for these URLs (McpAuth
  // skips bundledBackend MCPs) — they always point at the in-stack services.
  // Setting OTEL_EXPORTER_OTLP_ENDPOINT turns on the api's gen_ai OTLP export to
  // the collector, which Prometheus scrapes for the admin-console dashboard.
  if (enabled.has('prometheus') || enabled.has('loki')) {
    env.PROMETHEUS_URL = 'http://prometheus:9090';
    env.LOKI_URL = 'http://loki:3100';
    env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://otel-collector:4317';
  }

  // Inline auth values — whatever the user typed in McpAuth fields.
  for (const [k, v] of Object.entries(c.mcpAuth)) {
    if (k.startsWith('__skip_')) continue;  // markers, not real env vars
    if (v) env[k] = v;
  }

  return env;
}

// Exported for the PTY test harness so it can assert .env contents without
// parsing the file a second time.
export const __toEnv = toEnv;
