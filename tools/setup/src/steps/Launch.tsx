import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import open from 'open';
import { Screen, Hint, COLORS } from '../ui/Theme.tsx';
import type { WizardConfig } from '../lib/types.ts';
import { writeEnv } from '../lib/env.ts';
import { launchDocker } from '../backends/docker.ts';
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

// ── AWS Bedrock bootstrap constants ──────────────────────────────────────────
// The Claude Sonnet 4.6 Bedrock model id, verified to round-trip live (it is
// both in AWSBedrockProvider.MODEL_TO_INFERENCE_PROFILE → us.* profile AND
// accepted by `aws bedrock-runtime invoke-model`). This base id is what the
// seeded role='chat' assignment uses; the provider maps it to the inference
// profile at call time.
const BEDROCK_CHAT_MODEL = 'anthropic.claude-sonnet-4-6';
// Embeddings stay on Ollama nomic-embed-text (768) — the dimension the
// halfvec columns + Milvus collections are built at, and the only key-free
// embedding path that boots healthy regardless of when AWS creds resolve.
const BOOTSTRAP_EMBED_MODEL = 'nomic-embed-text';
const BOOTSTRAP_EMBED_DIM = 768;
// The local Ollama chat model seeded under the "Both" strategy as a SECOND,
// selectable chat model alongside Bedrock. It is NOT the default — the
// secondary-Ollama seeder lands it at a higher priority NUMBER (lower
// precedence) than the Bedrock bootstrap chat row (priority 10), so
// getDefaultChatModel() still resolves Claude Sonnet 4.6. Setting this also
// makes ollama-init pre-pull the tag on first boot.
const OLLAMA_CHAT_MODEL = 'gpt-oss:20b';
// Gates RegistryBootstrapSeeder, which only (re)seeds when this value is greater
// than the registry_seeder_version persisted in the DB (default 0 on a fresh
// install) — so any value >0 writes the Bedrock chat role-assignment row on boot.
const BEDROCK_SEEDER_VERSION = '6';

// ── Google Vertex AI bootstrap constants ─────────────────────────────────────
// Vertex is the GCP-native cloud strategy: gemini-2.5-pro chat + text-embedding-005
// embeddings (768-dim, the halfvec/Milvus dimension) + Imagen, all authenticated
// with a mounted service-account key (ADC). The vertex-ai bootstrap provider
// auto-seeds gemini-2.5-pro as role='chat' via LLMProviderSeeder (no admin step),
// PROVIDED ADMIN_USER_EMAIL resolves to a seeded user.
const VERTEX_CHAT_MODEL = 'gemini-2.5-pro';
const VERTEX_EMBED_MODEL = 'text-embedding-005';
const VERTEX_EMBED_DIM = 768;
const VERTEX_IMAGE_MODEL = 'imagen-4.0-generate-001';
// In-container path the host SA key is mounted to (compose volume); the chat
// provider + embedding service both read GOOGLE_APPLICATION_CREDENTIALS = this.
const VERTEX_SA_KEY_CONTAINER_PATH = '/var/secrets/gcp/key.json';

export const LaunchStep: React.FC<Props> = ({ config, step, total, onDone }) => {
  const [tasks, setTasks] = useState<Task[]>(() => {
    const baseLabels = DRY_RUN
      ? ['Write .env (dry-run)', 'Skip build (dry-run)', 'Skip start (dry-run)', 'Skip health (dry-run)', 'Skip browser (dry-run)']
      : [
          'Write .env',
          config.target === 'docker' ? 'Build images' : 'Render chart',
          config.target === 'docker' ? 'Start containers' : 'Apply release',
          'Wait for health',
          'Open browser',
        ];
    return baseLabels.map((label) => ({ label, state: 'pending' as const }));
  });

  const setTask = (i: number, patch: Partial<Task>) =>
    setTasks((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setTask(0, { state: 'running' });
        writeEnv(toEnv(config));
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
          onBuildDone: () => !cancelled && setTask(1, { state: 'ok' }),
          onStart: (msg) => !cancelled && setTask(2, { state: 'running', detail: msg }),
          onStartDone: () => !cancelled && setTask(2, { state: 'ok' }),
          onHealth: (msg) => !cancelled && setTask(3, { state: 'running', detail: msg }),
          onHealthDone: () => !cancelled && setTask(3, { state: 'ok' }),
        });

        if (cancelled) return;
        setTask(4, { state: 'running', detail: url });
        try { await open(url); } catch { /* browser open is best-effort */ }
        setTask(4, { state: 'ok', detail: url });

        setTimeout(onDone, 1200);
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        setTasks((ts) => ts.map((t) => (t.state === 'running' ? { ...t, state: 'fail', detail: msg } : t)));
      }
    })();
    return () => { cancelled = true; };
  }, [config]);

  return (
    <Screen step={step} total={total} title={DRY_RUN ? 'Bringing up openagentic (dry-run)' : 'Bringing up openagentic'}>
      <Box flexDirection="column">
        {tasks.map((t, i) => (
          <Box key={i}>
            <Text color={icon(t.state).color}>{icon(t.state).char}</Text>
            <Text> </Text>
            <Text>{t.label}</Text>
            {t.detail ? (
              <Text color={COLORS.muted}>  {t.detail.slice(0, 80)}</Text>
            ) : null}
          </Box>
        ))}
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

function icon(s: TaskState): { char: string; color: string } {
  switch (s) {
    case 'ok':      return { char: '✓', color: COLORS.ok };
    case 'fail':    return { char: '✗', color: COLORS.err };
    case 'running': return { char: '◦', color: COLORS.accent };
    default:        return { char: '·', color: COLORS.muted };
  }
}

function toEnv(c: WizardConfig): Record<string, string> {
  const useOllama = c.llmStrategy === 'ollama' || c.llmStrategy === 'both';
  const useCloud  = c.llmStrategy === 'cloud'  || c.llmStrategy === 'both';
  const useVertex = c.llmStrategy === 'vertex';

  const env: Record<string, string> = {
    ADMIN_USER_EMAIL: c.admin.email,
    ADMIN_SEED_PASSWORD: c.admin.password,
    LOCAL_ADMIN_USERNAME: c.admin.name,
    UI_HOST_PORT: String(c.uiPort),
    MCPS_ENABLED: c.mcps.join(','),
  };

  // Ollama envs only when the strategy includes it. When skipped/cloud-only
  // we explicitly disable Ollama so the api doesn't try to hit a phantom
  // endpoint on first boot.
  if (useOllama) {
    env.OLLAMA_HOST = c.ollama.host;
    env.OLLAMA_EMBED_MODEL = c.ollama.embedModel;
    env.OLLAMA_ENABLED = 'true';
    // Under "Both", seed gpt-oss:20b as a SECOND, selectable chat model.
    // OLLAMA_CHAT_MODEL drives ollama-init's pre-pull AND the secondary-Ollama
    // provider seed (LLMProviderSeeder.seedSecondaryOllamaProvider), which
    // lands the ollama chat row at a HIGHER priority number than the Bedrock
    // bootstrap (priority 10) — so Bedrock Claude Sonnet 4.6 stays the default
    // chat model. Ollama-only mode leaves chat to env-fallback (no bootstrap
    // provider), so we don't set it there.
    if (c.llmStrategy === 'both') {
      env.OLLAMA_CHAT_MODEL = OLLAMA_CHAT_MODEL;
    }
  } else {
    env.OLLAMA_ENABLED = 'false';
  }

  // Cloud LLMs are AWS Bedrock (Claude via IAM) ONLY — no raw provider API
  // keys (firm product decision). Seed an aws-bedrock bootstrap provider with
  // Claude Sonnet 4.6 as the default chat model, which the smart router uses
  // for chat AND for flows (flow agents use model:'auto' → getDefaultChatModel
  // → the role='chat' assignment row seeded from BOOTSTRAP_PROVIDER_DEFAULTS).
  const bedrock = c.providers.awsBedrock;
  if (useCloud && bedrock) {
    const region = (bedrock.region || 'us-east-1').trim() || 'us-east-1';
    env.AWS_REGION = region;

    // Credential material per auth path. The bootstrap provider config carries
    // ONLY the region (no secrets) — the AWSBedrockProvider resolves creds from
    // the container's AWS_* env / default credential chain (host ~/.aws mount).
    if (bedrock.accessKeyId && bedrock.secretAccessKey) {
      // Inline IAM keys.
      env.AWS_ACCESS_KEY_ID = bedrock.accessKeyId;
      env.AWS_SECRET_ACCESS_KEY = bedrock.secretAccessKey;
    } else if (bedrock.profile) {
      // Named profile — resolved from the mounted host ~/.aws.
      env.AWS_PROFILE = bedrock.profile;
    }
    // host-creds path writes nothing secret — just AWS_REGION + the mount.

    // Bootstrap provider block — Bedrock is the SOLE chat bootstrap provider.
    env.BOOTSTRAP_PROVIDER_NAME = 'aws-bedrock';
    env.BOOTSTRAP_PROVIDER_DISPLAY_NAME = 'AWS Bedrock';
    env.BOOTSTRAP_PROVIDER_TYPE = 'aws-bedrock';
    env.BOOTSTRAP_PROVIDER_CONFIG = JSON.stringify({ region });
    env.BOOTSTRAP_PROVIDER_DEFAULTS = JSON.stringify({
      chat: BEDROCK_CHAT_MODEL,
      embedding: BOOTSTRAP_EMBED_MODEL,
      embeddingDimension: BOOTSTRAP_EMBED_DIM,
    });
    env.SEEDER_VERSION = BEDROCK_SEEDER_VERSION;
  }

  // Google Vertex AI (GCP-native, service-account / ADC — no API keys). Seeds a
  // vertex-ai bootstrap provider (gemini-2.5-pro default chat, auto-seeded by
  // LLMProviderSeeder) AND routes embeddings through Vertex. The runtime reads
  // TWO separate env families with no cross-fallback: chat → GOOGLE_CLOUD_*,
  // embeddings → GCP_* (set both from the same project/region).
  const vertex = c.providers.vertex;
  if (useVertex && vertex) {
    const project = (vertex.project || '').trim();
    const region = (vertex.region || 'us-central1').trim() || 'us-central1';
    const chatModel = vertex.chatModel || VERTEX_CHAT_MODEL;
    const embeddingModel = vertex.embedModel || VERTEX_EMBED_MODEL;
    const imageModel = vertex.imageModel || VERTEX_IMAGE_MODEL;

    // Chat provider (GoogleVertexProvider reads GOOGLE_CLOUD_PROJECT/LOCATION).
    env.GOOGLE_CLOUD_PROJECT = project;
    env.GOOGLE_CLOUD_LOCATION = region;
    // Mirrored so a re-run of the wizard re-detects the vertex strategy (index.tsx).
    env.VERTEX_PROJECT = project;
    env.VERTEX_LOCATION = region;

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
    // Default image-gen model (read by the admin/agent image path).
    env.DEFAULT_IMAGE_MODEL = imageModel;

    // ADC via a mounted SA key. The host key is mounted to a fixed in-container
    // path by compose (GCP_SA_KEY_FILE feeds the volume source).
    if (vertex.saKeyPath) {
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
    // chat/embedding/embeddingDimension (an 'image' key would be silently dropped).
    env.BOOTSTRAP_PROVIDER_NAME = 'google-vertex';
    env.BOOTSTRAP_PROVIDER_DISPLAY_NAME = 'Google Vertex AI';
    env.BOOTSTRAP_PROVIDER_TYPE = 'vertex-ai';
    env.BOOTSTRAP_PROVIDER_CONFIG = JSON.stringify({ projectId: project, location: region });
    env.BOOTSTRAP_PROVIDER_DEFAULTS = JSON.stringify({
      chat: chatModel,
      embedding: embeddingModel,
      embeddingDimension: VERTEX_EMBED_DIM,
    });
    env.SEEDER_VERSION = BEDROCK_SEEDER_VERSION;
  }

  // Per-MCP gating: flip the proxy's *_DISABLED var for anything NOT selected.
  // Selected ones get the env explicitly set to "false" so re-running the
  // wizard and un-disabling clears any stale "true" from a prior run.
  const enabled = new Set(c.mcps);
  for (const mcp of MCPS) {
    env[mcp.disabledEnv] = enabled.has(mcp.id) ? 'false' : 'true';
  }

  // Inline auth values — whatever the user typed in McpAuth fields.
  for (const [k, v] of Object.entries(c.mcpAuth)) {
    if (k.startsWith('__skip_')) continue;  // markers, not real env vars
    if (v) env[k] = v;
  }

  // Auth provider. Default 'local' writes nothing extra (local username/password
  // only — the public OSS edition). Entra SSO emits AUTH_PROVIDER + the AZURE_AD_*
  // login config; the SAME app registration is mirrored to AZURE_TENANT_ID/
  // CLIENT_ID/CLIENT_SECRET so the OBO services (run azure/aws/gcp tools as the
  // signed-in user) authenticate with the same credentials.
  if (c.auth.provider === 'azure-ad' && c.auth.entra) {
    const e = c.auth.entra;
    env.AUTH_PROVIDER = 'azure-ad';
    env.AZURE_AD_TENANT_ID = e.tenantId;
    env.AZURE_AD_CLIENT_ID = e.clientId;
    env.AZURE_AD_CLIENT_SECRET = e.clientSecret;
    if (e.redirectUri) env.AZURE_AD_REDIRECT_URI = e.redirectUri;
    if (e.userGroups) env.AZURE_AD_AUTHORIZED_GROUPS = e.userGroups;
    if (e.adminGroups) env.AZURE_ADMIN_GROUPS = e.adminGroups;
    if (e.externalAdminEmails) env.EXTERNAL_ADMIN_EMAILS = e.externalAdminEmails;
    // OBO mirror — same app registration drives the on-behalf-of token exchange.
    env.AZURE_TENANT_ID = e.tenantId;
    env.AZURE_CLIENT_ID = e.clientId;
    env.AZURE_CLIENT_SECRET = e.clientSecret;
  }

  return env;
}

// Exported for the PTY test harness so it can assert .env contents without
// parsing the file a second time.
export const __toEnv = toEnv;
