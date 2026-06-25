import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { Screen, Hint, COLORS } from '../ui/Theme.tsx';
import type { WizardConfig, LlmStrategy } from '../lib/types.ts';
import { mcpsThatNeedAuth } from '../lib/mcps.ts';

const describeStrategy = (s: LlmStrategy): string => {
  switch (s) {
    case 'none':   return 'none chosen — chat will fail until you pick a provider';
    case 'ollama': return 'Ollama — local models on this machine';
    case 'bedrock':return 'AWS Bedrock — models via your AWS account';
    case 'vertex': return 'Google Vertex AI — Gemini models via your GCP project';
    case 'aif':    return 'Azure AI Foundry — models via your Azure endpoint';
    case 'openai': return 'OpenAI — models via the OpenAI API';
    case 'huggingface': return 'Hugging Face — your Inference Endpoint / TGI server';
    case 'skip':   return 'skipped — configure in admin panel';
  }
};

/** Human summary of the chosen AWS Bedrock auth path for the review screen. */
const describeBedrock = (b: WizardConfig['providers']['bedrock']): string => {
  if (!b) return 'none — chat will fail until set';
  const auth = b.authMode === 'awslogin' ? 'current AWS login (~/.aws)' : 'inline IAM keys';
  return `${auth}, region ${b.region}`;
};

/** Human summary of the chosen Vertex AI config for the review screen. */
const describeVertex = (v: WizardConfig['providers']['vertex']): string => {
  if (!v || !v.projectId) return 'none — chat will fail until set';
  const auth = v.authMode === 'sajson' ? `SA key ${v.saKeyPath || ''}` : 'current gcloud login (ADC)';
  return `${v.projectId} (${v.location}), ${auth}`;
};

/** Human summary of the chosen Azure AI Foundry config for the review screen. */
const describeAif = (a: WizardConfig['providers']['azureFoundry']): string => {
  if (!a || !a.endpointUrl) return 'none — chat will fail until set';
  const auth = a.authMode === 'apikey'
    ? 'API key'
    : a.authMode === 'entra'
      ? 'Microsoft Entra app'
      : 'current az login (~/.azure)';
  return `${a.endpointUrl}, ${auth}`;
};

/** Human summary of the chosen OpenAI config for the review screen. */
const describeOpenai = (o: WizardConfig['providers']['openai']): string => {
  if (!o || !o.apiKey) return 'none — chat will fail until set';
  return 'API key set';
};

/** Human summary of the chosen Hugging Face config for the review screen. */
const describeHf = (h: WizardConfig['providers']['huggingface']): string => {
  if (!h || !h.endpointUrl) return 'none — chat will fail until set';
  return `${h.endpointUrl} (OpenAI-compatible)`;
};

interface Props {
  config: WizardConfig;
  step: number;
  total: number;
  onLaunch: () => void;
  onCancel: () => void;
}

export const ReviewStep: React.FC<Props> = ({ config, step, total, onLaunch, onCancel }) => {
  // Summarize MCPs: enabled count + which ones still need creds filled in.
  const needAuth = mcpsThatNeedAuth(config.mcps);
  const missingCreds = needAuth.filter((m) => {
    // field-type MCPs are "missing" if the user didn't supply any of the envVars
    if (m.authType === 'fields' && m.envVars) {
      return !m.envVars.some((f) => config.mcpAuth[f.env]);
    }
    // env-file MCPs rely on files on disk, which we can't inspect from here;
    // treat as "not blocked" and let the proxy log if the file is missing.
    return false;
  });
  const mcpSummary =
    config.mcps.length === 0
      ? 'none selected'
      : `${config.mcps.length} enabled (${config.mcps.slice(0, 4).join(', ')}${config.mcps.length > 4 ? '…' : ''})`;

  const row = (label: string, value: string, color?: string) => (
    <Box key={label}>
      <Box width={18}>
        <Text color={COLORS.muted}>{label}</Text>
      </Box>
      <Text color={color}>{value}</Text>
    </Box>
  );

  return (
    <Screen step={step} total={total} title="Review & launch">
      <Box flexDirection="column">
        {row('deploy target', config.target)}
        {config.target === 'helm' && config.kubeconfigPath && row('kubeconfig', config.kubeconfigPath)}
        {row('admin email', config.admin.email)}
        {row('LLM strategy', describeStrategy(config.llmStrategy))}
        {config.llmStrategy === 'ollama' &&
          row('ollama host', config.ollama.host)}
        {config.llmStrategy === 'ollama' &&
          row('embedding model', config.ollama.embedModel)}
        {config.llmStrategy === 'bedrock' &&
          row('AWS Bedrock', describeBedrock(config.providers.bedrock))}
        {config.llmStrategy === 'bedrock' &&
          row('chat model', config.providers.bedrock?.model || 'amazon.nova-pro-v1:0')}
        {config.llmStrategy === 'vertex' &&
          row('Vertex AI', describeVertex(config.providers.vertex), config.providers.vertex?.projectId ? undefined : COLORS.err)}
        {config.llmStrategy === 'vertex' &&
          row('chat model', config.providers.vertex?.model || 'gemini-1.5-pro')}
        {config.llmStrategy === 'aif' &&
          row('Azure AI Foundry', describeAif(config.providers.azureFoundry), config.providers.azureFoundry?.endpointUrl ? undefined : COLORS.err)}
        {config.llmStrategy === 'aif' &&
          row('deployment / model', config.providers.azureFoundry?.deploymentName || '(unset)', config.providers.azureFoundry?.deploymentName ? undefined : COLORS.err)}
        {config.llmStrategy === 'openai' &&
          row('OpenAI', describeOpenai(config.providers.openai), config.providers.openai?.apiKey ? undefined : COLORS.err)}
        {config.llmStrategy === 'openai' &&
          row('chat model', config.providers.openai?.model || 'gpt-4o-mini')}
        {config.llmStrategy === 'huggingface' &&
          row('Hugging Face', describeHf(config.providers.huggingface), config.providers.huggingface?.endpointUrl ? undefined : COLORS.err)}
        {config.llmStrategy === 'huggingface' &&
          row('served model', config.providers.huggingface?.model || '(unset)', config.providers.huggingface?.model ? undefined : COLORS.err)}
        {row('MCPs', mcpSummary)}
        {row('UI port', String(config.uiPort))}
        {missingCreds.length > 0 && (
          <Box marginTop={1}>
            <Text color={COLORS.err}>⚠ missing creds: {missingCreds.map((m) => m.label).join(', ')}</Text>
          </Box>
        )}
      </Box>
      <Box marginTop={1}>
        <SelectInput
          items={[
            { label: `Launch ${config.target}`, value: 'go' as const },
            { label: 'Cancel', value: 'no' as const },
          ]}
          onSelect={(i) => (i.value === 'go' ? onLaunch() : onCancel())}
          indicatorComponent={({ isSelected }) => <Text color={COLORS.accent}>{isSelected ? '❯ ' : '  '}</Text>}
        />
      </Box>
      <Box marginTop={1}>
        <Hint>Nothing has been written to disk yet. Launch will write .env and bring the stack up.</Hint>
      </Box>
    </Screen>
  );
};
