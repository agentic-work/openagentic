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
  const env: Record<string, string> = {
    ADMIN_USER_EMAIL: c.admin.email,
    ADMIN_SEED_PASSWORD: c.admin.password,
    LOCAL_ADMIN_USERNAME: c.admin.name,
    OLLAMA_HOST: c.ollama.host,
    OLLAMA_EMBED_MODEL: c.ollama.embedModel,
    CODING_ADAPTER: c.codingAdapter,
    UI_HOST_PORT: String(c.uiPort),
    MCPS_ENABLED: c.mcps.join(','),
  };
  if (c.providers.anthropic)            env.ANTHROPIC_API_KEY = c.providers.anthropic;
  if (c.providers.openai)               env.OPENAI_API_KEY = c.providers.openai;
  if (c.providers.google)               env.GOOGLE_GENERATIVE_AI_API_KEY = c.providers.google;
  if (c.providers.azureOpenAIEndpoint)  env.AZURE_OPENAI_ENDPOINT = c.providers.azureOpenAIEndpoint;
  if (c.providers.azureOpenAIKey)       env.AZURE_OPENAI_API_KEY = c.providers.azureOpenAIKey;

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
