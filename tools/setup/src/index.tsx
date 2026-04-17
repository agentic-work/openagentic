import React, { useState } from 'react';
import { render, Box, Text } from 'ink';
import { Banner, COLORS } from './ui/Theme.tsx';
import { DeployTargetStep } from './steps/DeployTarget.tsx';
import { HelmPreflightStep } from './steps/HelmPreflight.tsx';
import { AdminUserStep } from './steps/AdminUser.tsx';
import { OllamaStep } from './steps/Ollama.tsx';
import { ProvidersStep } from './steps/Providers.tsx';
import { McpSelectionStep } from './steps/McpSelection.tsx';
import { McpAuthStep } from './steps/McpAuth.tsx';
import { CodingCliStep } from './steps/CodingCli.tsx';
import { ReviewStep } from './steps/Review.tsx';
import { LaunchStep } from './steps/Launch.tsx';
import { DEFAULT_CONFIG, type WizardConfig, type DeployTarget, type CodingAdapterId } from './lib/types.ts';
import { defaultEnabledMcps } from './lib/mcps.ts';
import { readCurrent } from './lib/env.ts';

type Screen = 'target' | 'helm-preflight' | 'admin' | 'ollama' | 'providers' | 'mcps' | 'mcp-auth' | 'coding' | 'review' | 'launch' | 'done';

const App: React.FC = () => {
  // Seed from any existing .env so re-running the wizard is non-destructive.
  const existing = readCurrent();
  const [config, setConfig] = useState<WizardConfig>(() => ({
    ...DEFAULT_CONFIG,
    admin: {
      ...DEFAULT_CONFIG.admin,
      email: existing.ADMIN_USER_EMAIL || DEFAULT_CONFIG.admin.email,
      name: existing.LOCAL_ADMIN_USERNAME || DEFAULT_CONFIG.admin.name,
    },
    ollama: {
      ...DEFAULT_CONFIG.ollama,
      host: existing.OLLAMA_HOST || DEFAULT_CONFIG.ollama.host,
      embedModel: existing.OLLAMA_EMBED_MODEL || DEFAULT_CONFIG.ollama.embedModel,
    },
    providers: {
      anthropic: existing.ANTHROPIC_API_KEY || undefined,
      openai: existing.OPENAI_API_KEY || undefined,
      google: existing.GOOGLE_GENERATIVE_AI_API_KEY || undefined,
      azureOpenAIEndpoint: existing.AZURE_OPENAI_ENDPOINT || undefined,
      azureOpenAIKey: existing.AZURE_OPENAI_API_KEY || undefined,
    },
    codingAdapter: ((existing.CODING_ADAPTER as CodingAdapterId | undefined) || DEFAULT_CONFIG.codingAdapter),
    mcps: existing.MCPS_ENABLED ? existing.MCPS_ENABLED.split(',').map((s: string) => s.trim()).filter(Boolean) : defaultEnabledMcps(),
    mcpAuth: {},
    uiPort: existing.UI_HOST_PORT ? Number(existing.UI_HOST_PORT) : DEFAULT_CONFIG.uiPort,
  }));
  const [screen, setScreen] = useState<Screen>('target');

  // Step numbering — Docker path = 9 screens total, Helm path inserts a
  // preflight as step 2/10 so downstream steps bump by 1.
  const total = config.target === 'helm' ? 10 : 9;
  const stepOffset = config.target === 'helm' ? 1 : 0;  // admin onwards shift +1 on Helm
  const stepNum = {
    target: 1,
    helmPreflight: 2,
    admin: 2 + stepOffset,
    ollama: 3 + stepOffset,
    providers: 4 + stepOffset,
    mcps: 5 + stepOffset,
    mcpAuth: 6 + stepOffset,
    coding: 7 + stepOffset,
    review: 8 + stepOffset,
    launch: 9 + stepOffset,
  };

  if (screen === 'target') {
    return (
      <DeployTargetStep
        onPick={(t: DeployTarget) => {
          setConfig({ ...config, target: t });
          setScreen(t === 'helm' ? 'helm-preflight' : 'admin');
        }}
      />
    );
  }
  if (screen === 'helm-preflight') {
    return (
      <HelmPreflightStep
        onContinue={(kubeconfigPath) => {
          setConfig({ ...config, kubeconfigPath });
          setScreen('admin');
        }}
        onBackToDocker={() => {
          setConfig({ ...config, target: 'docker', kubeconfigPath: undefined });
          setScreen('admin');
        }}
      />
    );
  }
  if (screen === 'admin') {
    return (
      <AdminUserStep
        initial={config.admin}
        step={stepNum.admin}
        total={total}
        onDone={(admin) => {
          setConfig({ ...config, admin });
          setScreen('ollama');
        }}
      />
    );
  }
  if (screen === 'ollama') {
    return (
      <OllamaStep
        initial={config.ollama}
        step={stepNum.ollama}
        total={total}
        onDone={(ollama) => {
          setConfig({ ...config, ollama });
          setScreen('providers');
        }}
      />
    );
  }
  if (screen === 'providers') {
    return (
      <ProvidersStep
        initial={config.providers}
        step={stepNum.providers}
        total={total}
        onDone={(providers) => {
          setConfig({ ...config, providers });
          setScreen('mcps');
        }}
      />
    );
  }
  if (screen === 'mcps') {
    return (
      <McpSelectionStep
        initial={config.mcps}
        step={stepNum.mcps}
        total={total}
        onDone={(mcps) => {
          setConfig({ ...config, mcps });
          setScreen('mcp-auth');
        }}
      />
    );
  }
  if (screen === 'mcp-auth') {
    return (
      <McpAuthStep
        enabledIds={config.mcps}
        initialAuth={config.mcpAuth}
        step={stepNum.mcpAuth}
        total={total}
        onDone={(mcpAuth) => {
          // Drop any MCP the user said "skip" on from the enabled list
          const skipped = Object.keys(mcpAuth).filter((k) => k.startsWith('__skip_')).map((k) => k.slice(7));
          const cleanAuth: Record<string, string> = {};
          for (const [k, v] of Object.entries(mcpAuth)) if (!k.startsWith('__skip_')) cleanAuth[k] = v;
          setConfig({
            ...config,
            mcps: config.mcps.filter((id) => !skipped.includes(id)),
            mcpAuth: cleanAuth,
          });
          setScreen('coding');
        }}
      />
    );
  }
  if (screen === 'coding') {
    return (
      <CodingCliStep
        initial={config.codingAdapter}
        step={stepNum.coding}
        total={total}
        onPick={(id) => {
          setConfig({ ...config, codingAdapter: id });
          setScreen('review');
        }}
      />
    );
  }
  if (screen === 'review') {
    return (
      <ReviewStep
        config={config}
        step={stepNum.review}
        total={total}
        onLaunch={() => setScreen('launch')}
        onCancel={() => process.exit(0)}
      />
    );
  }
  if (screen === 'launch') {
    return <LaunchStep config={config} step={stepNum.launch} total={total} onDone={() => setScreen('done')} />;
  }
  return (
    <Box flexDirection="column">
      <Banner />
      <Box marginLeft={2} flexDirection="column">
        <Text color={COLORS.ok} bold>
          openagentic is running
        </Text>
        <Text color={COLORS.muted}>open http://localhost:{config.uiPort} in your browser</Text>
        <Text color={COLORS.muted}>sign in with {config.admin.email}</Text>
      </Box>
    </Box>
  );
};

render(<App />);
