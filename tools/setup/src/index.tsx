import React, { useState } from 'react';
import { render, Box, Text } from 'ink';
import { Banner, COLORS } from './ui/Theme.tsx';
import { DeployTargetStep } from './steps/DeployTarget.tsx';
import { AdminUserStep } from './steps/AdminUser.tsx';
import { OllamaStep } from './steps/Ollama.tsx';
import { ProvidersStep } from './steps/Providers.tsx';
import { ReviewStep } from './steps/Review.tsx';
import { LaunchStep } from './steps/Launch.tsx';
import { DEFAULT_CONFIG, type WizardConfig, type DeployTarget } from './lib/types.ts';
import { readCurrent } from './lib/env.ts';

type Screen = 'target' | 'admin' | 'ollama' | 'providers' | 'review' | 'launch' | 'done';

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
    uiPort: existing.UI_HOST_PORT ? Number(existing.UI_HOST_PORT) : DEFAULT_CONFIG.uiPort,
  }));
  const [screen, setScreen] = useState<Screen>('target');

  if (screen === 'target') {
    return (
      <DeployTargetStep
        onPick={(t: DeployTarget) => {
          setConfig({ ...config, target: t });
          setScreen('admin');
        }}
      />
    );
  }
  if (screen === 'admin') {
    return (
      <AdminUserStep
        initial={config.admin}
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
        onDone={(providers) => {
          setConfig({ ...config, providers });
          setScreen('review');
        }}
      />
    );
  }
  if (screen === 'review') {
    return (
      <ReviewStep
        config={config}
        onLaunch={() => setScreen('launch')}
        onCancel={() => process.exit(0)}
      />
    );
  }
  if (screen === 'launch') {
    return <LaunchStep config={config} onDone={() => setScreen('done')} />;
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
