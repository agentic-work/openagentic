import React, { useState } from 'react';
import { realpathSync } from 'fs';
import { fileURLToPath } from 'url';
import open from 'open';
import { render, Box, Text, useInput } from 'ink';
import { Banner, COLORS } from './ui/Theme.tsx';
import { Help } from './ui/Help.tsx';
import { getDocFor } from './lib/docs.ts';
import { WizardErrorBoundary } from './ui/ErrorScreen.tsx';
import { DeployTargetStep } from './steps/DeployTarget.tsx';
import { HelmPreflightStep } from './steps/HelmPreflight.tsx';
import { AdminUserStep } from './steps/AdminUser.tsx';
import { LlmStrategyStep } from './steps/LlmStrategy.tsx';
import type { LlmStrategy } from './lib/types.ts';
import { OllamaStep } from './steps/Ollama.tsx';
import { ProvidersStep } from './steps/Providers.tsx';
import { VertexStep } from './steps/Vertex.tsx';
import { AzureFoundryStep } from './steps/AzureFoundry.tsx';
import { OpenAIStep } from './steps/OpenAI.tsx';
import { HuggingFaceStep } from './steps/HuggingFace.tsx';
import { McpSelectionStep } from './steps/McpSelection.tsx';
import { McpAuthStep } from './steps/McpAuth.tsx';
import { ReviewStep } from './steps/Review.tsx';
import { LaunchStep } from './steps/Launch.tsx';
import { DEFAULT_CONFIG, type WizardConfig, type DeployTarget } from './lib/types.ts';
import { defaultEnabledMcps } from './lib/mcps.ts';
import { readCurrent } from './lib/env.ts';

type Screen = 'target' | 'helm-preflight' | 'admin' | 'llm-strategy' | 'ollama' | 'providers' | 'vertex' | 'aif' | 'openai' | 'huggingface' | 'mcps' | 'mcp-auth' | 'review' | 'launch' | 'done';

export const App: React.FC = () => {
  // Seed from any existing .env so re-running the wizard is non-destructive.
  const existing = readCurrent();
  const [config, setConfig] = useState<WizardConfig>(() => ({
    ...DEFAULT_CONFIG,
    // Re-detect a prior headless install so a wizard re-run keeps the choice.
    headless: existing.OPENAGENTIC_HEADLESS === 'true',
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
    // Hydrate the chosen cloud provider from a prior .env so a re-run is sticky.
    // AWS_* on disk → Bedrock; else AIF_ENDPOINT_URL → Azure AI Foundry; else
    // GOOGLE_CLOUD_PROJECT/VERTEX_PROJECT → Vertex; else OPENAI_BASE_URL → Hugging
    // Face (OpenAI-compatible custom endpoint); else OPENAI_API_KEY → OpenAI.
    // (The cloud providers are mutually exclusive top-level strategies.)
    providers: (existing.AWS_REGION || existing.AWS_ACCESS_KEY_ID)
      ? {
          bedrock: {
            authMode: existing.AWS_ACCESS_KEY_ID ? ('keys' as const) : ('awslogin' as const),
            region: existing.AWS_REGION || 'us-east-1',
            accessKeyId: existing.AWS_ACCESS_KEY_ID || undefined,
            secretAccessKey: existing.AWS_SECRET_ACCESS_KEY || undefined,
            model: existing.BEDROCK_CHAT_MODEL || 'amazon.nova-pro-v1:0',
          },
        }
      : existing.AIF_ENDPOINT_URL
        ? {
            azureFoundry: {
              authMode: existing.AIF_API_KEY
                ? ('apikey' as const)
                : (existing.AIF_TENANT_ID && existing.AIF_CLIENT_ID && existing.AIF_CLIENT_SECRET)
                  ? ('entra' as const)
                  : ('azlogin' as const),
              endpointUrl: existing.AIF_ENDPOINT_URL || '',
              apiKey: existing.AIF_API_KEY || undefined,
              tenantId: existing.AIF_TENANT_ID || undefined,
              clientId: existing.AIF_CLIENT_ID || undefined,
              clientSecret: existing.AIF_CLIENT_SECRET || undefined,
              apiVersion: existing.AIF_API_VERSION || '2024-10-21',
              deploymentName: existing.AIF_MODEL || '',
            },
          }
        : (existing.VERTEX_PROJECT || existing.GOOGLE_CLOUD_PROJECT)
          ? {
              vertex: {
                authMode: existing.GCP_SA_KEY_FILE ? ('sajson' as const) : ('adc' as const),
                projectId: existing.VERTEX_PROJECT || existing.GOOGLE_CLOUD_PROJECT || '',
                location: existing.VERTEX_LOCATION || existing.GOOGLE_CLOUD_LOCATION || 'us-central1',
                model: existing.VERTEX_CHAT_MODEL || 'gemini-1.5-pro',
                saKeyPath: existing.GCP_SA_KEY_FILE || undefined,
              },
            }
          : existing.OPENAI_BASE_URL
            ? {
                huggingface: {
                  endpointUrl: existing.OPENAI_BASE_URL || '',
                  token: existing.OPENAI_API_KEY || '',
                  model: '',
                },
              }
            : existing.OPENAI_API_KEY
              ? {
                  openai: {
                    apiKey: existing.OPENAI_API_KEY || '',
                    model: '',
                  },
                }
              : {},
    mcps: existing.MCPS_ENABLED ? existing.MCPS_ENABLED.split(',').map((s: string) => s.trim()).filter(Boolean) : defaultEnabledMcps(),
    mcpAuth: {},
    uiPort: existing.UI_HOST_PORT ? Number(existing.UI_HOST_PORT) : DEFAULT_CONFIG.uiPort,
  }));
  const [screen, setScreen] = useState<Screen>('target');
  const llmStrategy = config.llmStrategy;
  const setLlmStrategy = (s: LlmStrategy) => setConfig((c) => ({ ...c, llmStrategy: s }));

  // Step numbering. The visible-step count varies with both the helm flag
  // (adds the preflight screen) and the LLM strategy (exactly one provider
  // step shows — Ollama, Bedrock, Vertex, or Azure AI Foundry — and "skip"
  // shows none).
  const helmBump = config.target === 'helm' ? 1 : 0;
  const ollamaCount    = (llmStrategy === 'ollama') ? 1 : 0;
  const providersCount = (llmStrategy === 'bedrock') ? 1 : 0;
  const vertexCount    = (llmStrategy === 'vertex') ? 1 : 0;
  const aifCount       = (llmStrategy === 'aif') ? 1 : 0;
  const openaiCount    = (llmStrategy === 'openai') ? 1 : 0;
  const hfCount        = (llmStrategy === 'huggingface') ? 1 : 0;
  // base (Docker, one provider): target + admin + llm-strategy + 1 provider step
  //   + mcps + mcp-auth + review + launch = 8
  const total = 1 + helmBump + 1 /*admin*/ + 1 /*llm-strategy*/ + ollamaCount + providersCount + vertexCount + aifCount + openaiCount + hfCount + 1 /*mcps*/ + 1 /*mcp-auth*/ + 1 /*review*/ + 1 /*launch*/;
  let cursor = 1;
  const stepNum = {
    target: cursor++,
    helmPreflight: config.target === 'helm' ? cursor++ : 0,
    admin: cursor++,
    llmStrategy: cursor++,
    ollama: ollamaCount ? cursor++ : 0,
    providers: providersCount ? cursor++ : 0,
    vertex: vertexCount ? cursor++ : 0,
    aif: aifCount ? cursor++ : 0,
    openai: openaiCount ? cursor++ : 0,
    huggingface: hfCount ? cursor++ : 0,
    mcps: cursor++,
    mcpAuth: cursor++,
    review: cursor++,
    launch: cursor++,
  };

  const afterLlmStrategy = (s: LlmStrategy): Screen => {
    if (s === 'ollama')  return 'ollama';
    if (s === 'bedrock') return 'providers';
    if (s === 'vertex')  return 'vertex';
    if (s === 'aif')     return 'aif';
    if (s === 'openai')  return 'openai';
    if (s === 'huggingface') return 'huggingface';
    return 'mcps';  // 'skip'
  };

  // --- Global help / docs shell -------------------------------------------
  // `?` toggles a help overlay and `d` opens the current step's docs. Both keys
  // are only grabbed on pure menu/select screens — never on screens that read
  // free text, where a literal "?" or "d" must reach the field. (The footer's
  // clickable doc Link still gives docs access on every screen, text ones too.)
  const [helpOpen, setHelpOpen] = useState(false);

  // The exact <Screen title=…> string per screen, so Help/docs resolve correctly.
  const SCREEN_TITLE: Record<Screen, string> = {
    target: 'Where do you want to run openagentic?',
    'helm-preflight': 'Checking your cluster',
    admin: 'Create your admin account',
    'llm-strategy': 'Which LLM provider should the platform use?',
    ollama: 'Where is your Ollama?',
    providers: 'AWS Bedrock — models via your AWS account',
    vertex: 'Google Vertex AI — Gemini via your GCP project',
    aif: 'Azure AI Foundry — models via your Azure endpoint',
    openai: 'OpenAI — models via the OpenAI API',
    huggingface: 'Hugging Face — your Inference Endpoint / TGI server',
    mcps: 'Which MCPs do you want enabled?',
    'mcp-auth': 'MCP credentials',
    review: 'Review & launch',
    launch: 'Bringing up openagentic',
    done: 'Review & launch',
  };

  // Screens with no free-text field — safe to claim `?`/`d` globally.
  const MENU_SCREENS = new Set<Screen>(['target', 'llm-strategy', 'mcps', 'review']);
  const currentTitle = SCREEN_TITLE[screen];

  useInput((input, key) => {
    if (helpOpen) {
      // Overlay is up: `?` or esc closes it; swallow everything else.
      if (input === '?' || key.escape) setHelpOpen(false);
      return;
    }
    if (!MENU_SCREENS.has(screen)) return; // don't steal keys from text fields
    if (input === '?') { setHelpOpen(true); return; }
    if (input === 'd') {
      // best-effort: open docs in the browser, swallow any failure
      open(getDocFor(currentTitle).url).catch(() => {});
      return;
    }
  });

  if (helpOpen) {
    return <Help title={currentTitle} onClose={() => setHelpOpen(false)} />;
  }

  if (screen === 'target') {
    return (
      <DeployTargetStep
        onPick={(t: DeployTarget, headless: boolean) => {
          setConfig({ ...config, target: t, headless });
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
          setScreen('llm-strategy');
        }}
      />
    );
  }
  if (screen === 'llm-strategy') {
    return (
      <LlmStrategyStep
        step={stepNum.llmStrategy}
        total={total}
        onPick={(s) => {
          setLlmStrategy(s);
          setScreen(afterLlmStrategy(s));
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
          setScreen('mcps');
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
  if (screen === 'vertex') {
    return (
      <VertexStep
        initial={config.providers}
        step={stepNum.vertex}
        total={total}
        onDone={(providers) => {
          setConfig({ ...config, providers });
          setScreen('mcps');
        }}
      />
    );
  }
  if (screen === 'aif') {
    return (
      <AzureFoundryStep
        initial={config.providers}
        step={stepNum.aif}
        total={total}
        onDone={(providers) => {
          setConfig({ ...config, providers });
          setScreen('mcps');
        }}
      />
    );
  }
  if (screen === 'openai') {
    return (
      <OpenAIStep
        initial={config.providers}
        step={stepNum.openai}
        total={total}
        onDone={(providers) => {
          setConfig({ ...config, providers });
          setScreen('mcps');
        }}
      />
    );
  }
  if (screen === 'huggingface') {
    return (
      <HuggingFaceStep
        initial={config.providers}
        step={stepNum.huggingface}
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

// Only run the wizard when this file is the executed entry point — when it is
// imported as a module instead, skip all of these side effects so importing is pure.
// Compare the real path of the invoked file to THIS module's path. realpath is
// essential: the npm `bin` runs us through a symlink
// (`node_modules/.bin/openagentic-setup`), so process.argv[1] is the symlink name —
// a filename-regex check misses it and render() never fires (the blank-wizard bug).
// realpath resolves the symlink to dist/index.js, which matches import.meta.url for:
// `node dist/index.js`, the bin symlink, npx, AND `tsx src/index.tsx`.
let isEntry = false;
try {
  isEntry = !!process.argv[1] &&
    realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
} catch { /* argv[1] missing/unreadable → treat as imported, stay pure */ }
if (isEntry) {
  // Start in a clean terminal — wipe the screen + scrollback so the wizard owns
  // the view and renders fresh from the top, not appended below earlier output.
  if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[3J\x1b[H');

  // Last-resort guards: an async throw outside React (e.g. a backend spawn) would
  // otherwise dump a raw stack trace. Point users at help instead, then exit non-zero.
  const bail = (err: unknown) => {
    const msg = err instanceof Error ? (err.stack || err.message) : String(err);
    process.stderr.write(
      `\n  ✗ The setup wizard hit an unexpected error.\n  ${msg}\n\n` +
      `  Diagnose:  curl -fsSL https://install.openagentics.io | bash -s -- --doctor\n` +
      `  Help:      https://openagentics.io/docs/troubleshooting\n` +
      `  Issues:    https://github.com/agentic-work/openagentic/issues\n\n`,
    );
    process.exit(1);
  };
  process.on('uncaughtException', bail);
  process.on('unhandledRejection', bail);

  render(
    <WizardErrorBoundary>
      <App />
    </WizardErrorBoundary>,
  );
}
