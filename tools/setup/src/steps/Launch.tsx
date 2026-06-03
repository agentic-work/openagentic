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
// Gates RegistryBootstrapSeeder, which only (re)seeds when this value is greater
// than the registry_seeder_version persisted in the DB (default 0 on a fresh
// install) — so any value >0 writes the Bedrock chat role-assignment row on boot.
const BEDROCK_SEEDER_VERSION = '6';

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

  return env;
}

// Exported for the PTY test harness so it can assert .env contents without
// parsing the file a second time.
export const __toEnv = toEnv;
