import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { Screen, Hint, COLORS } from '../ui/Theme.tsx';
import type { LlmStrategy } from '../lib/types.ts';

/**
 * Up-front choice between three ways to power chat + embeddings.
 * Gates whether the wizard visits the Ollama step, the cloud-LLM
 * providers step, or both. "skip" punts both — the user can wire LLMs
 * up later from the admin panel.
 */

interface Props {
  step: number;
  total: number;
  onPick: (s: LlmStrategy) => void;
}

const ITEMS: Array<{ label: string; value: LlmStrategy; hint: string }> = [
  {
    label: 'Local only — Ollama on this machine',
    value: 'ollama',
    hint: 'Zero API costs, fully offline. Need an Ollama install (https://ollama.com).',
  },
  {
    label: 'AWS Bedrock (Claude via IAM)',
    value: 'cloud',
    hint: 'Authenticate with AWS IAM creds — no raw API keys. Seeds Claude Sonnet 4.6 as the default chat + flows model.',
  },
  {
    label: 'Both — Ollama for embeddings, AWS Bedrock (Claude) for chat',
    value: 'both',
    hint: 'Best of both worlds: free local embeddings + frontier-grade Claude chat via AWS IAM (no raw keys).',
  },
  {
    label: 'Skip for now — configure later from the admin panel',
    value: 'skip',
    hint: 'Stack will boot, but chat/embedding calls will fail until you wire a provider.',
  },
];

export const LlmStrategyStep: React.FC<Props> = ({ step, total, onPick }) => (
  <Screen step={step} total={total} title="How should the platform call LLMs?">
    <Box flexDirection="column">
      <Hint>This decides where chat completions and embeddings get made.</Hint>
      <Hint>Cloud-management creds (Azure / AWS / GCP) are a separate step further down.</Hint>
      <Box marginTop={1}>
        <SelectInput
          items={ITEMS.map((i) => ({ label: i.label, value: i.value }))}
          onSelect={(i) => onPick(i.value as LlmStrategy)}
          indicatorComponent={({ isSelected }) => (
            <Text color={COLORS.accent}>{isSelected ? '❯ ' : '  '}</Text>
          )}
        />
      </Box>
      <Box marginTop={1} flexDirection="column">
        {ITEMS.map((i) => (
          <Text key={i.value} color={COLORS.muted}>
            {'  '}
            <Text bold>{i.label.split(' — ')[0]}</Text> — {i.hint}
          </Text>
        ))}
      </Box>
    </Box>
  </Screen>
);
