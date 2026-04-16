import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import open from 'open';
import { StepHeader, Hint, COLORS } from '../ui/Theme.tsx';
import type { WizardConfig } from '../lib/types.ts';
import { writeEnv } from '../lib/env.ts';
import { launchDocker } from '../backends/docker.ts';
import { launchHelm } from '../backends/helm.ts';

interface Props {
  config: WizardConfig;
  onDone: () => void;
}

type TaskState = 'pending' | 'running' | 'ok' | 'fail';
interface Task { label: string; state: TaskState; detail?: string; }

export const LaunchStep: React.FC<Props> = ({ config, onDone }) => {
  const [tasks, setTasks] = useState<Task[]>([
    { label: 'Write .env', state: 'pending' },
    { label: config.target === 'docker' ? 'Build images' : 'Render chart', state: 'pending' },
    { label: config.target === 'docker' ? 'Start containers' : 'Apply release', state: 'pending' },
    { label: 'Wait for health', state: 'pending' },
    { label: 'Open browser', state: 'pending' },
  ]);

  const setTask = (i: number, patch: Partial<Task>) =>
    setTasks((ts) => ts.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setTask(0, { state: 'running' });
        writeEnv(toEnv(config));
        setTask(0, { state: 'ok' });

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
    <Box flexDirection="column">
      <StepHeader step={6} total={6} title="Bringing up openagentic" />
      <Box marginLeft={2} flexDirection="column">
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
      <Box marginTop={1} marginLeft={2}>
        <Hint>First boot pulls the embedding model and seeds Milvus — give it a couple minutes.</Hint>
      </Box>
    </Box>
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
  };
  if (c.providers.anthropic)            env.ANTHROPIC_API_KEY = c.providers.anthropic;
  if (c.providers.openai)               env.OPENAI_API_KEY = c.providers.openai;
  if (c.providers.google)               env.GOOGLE_GENERATIVE_AI_API_KEY = c.providers.google;
  if (c.providers.azureOpenAIEndpoint)  env.AZURE_OPENAI_ENDPOINT = c.providers.azureOpenAIEndpoint;
  if (c.providers.azureOpenAIKey)       env.AZURE_OPENAI_API_KEY = c.providers.azureOpenAIKey;
  return env;
}
