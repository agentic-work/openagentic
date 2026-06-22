import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { Screen, Hint, COLORS } from '../ui/Theme.tsx';
import type { LlmStrategy } from '../lib/types.ts';

/**
 * Up-front, NEUTRAL choice of which LLM provider powers chat + embeddings.
 *
 * Product rule: the platform never defaults to, forces, or pushes a provider —
 * Ollama least of all. The highlighted first row is a non-provider sentinel
 * ("— select a provider —"), so SelectInput's default highlight lands on
 * nothing real. The user must explicitly move down and pick a provider (or the
 * explicit "skip / configure later"). No row is "recommended" or pre-ticked.
 *
 * Gates which downstream step runs: the Ollama host step, the AWS Bedrock step,
 * the Vertex step, or none ("skip").
 */

interface Props {
  step: number;
  total: number;
  onPick: (s: LlmStrategy) => void;
}

const ITEMS: Array<{ label: string; value: LlmStrategy; hint: string }> = [
  {
    label: '— select a provider (use ↓ to choose) —',
    value: 'none',
    hint: 'Nothing is pre-selected. Pick the provider you want — the platform never assumes one.',
  },
  {
    label: 'Ollama — local models on this machine',
    value: 'ollama',
    hint: 'Zero API costs, fully offline. Requires your own Ollama install (https://ollama.com). Only started when you pick it.',
  },
  {
    label: 'AWS Bedrock (Claude via IAM)',
    value: 'cloud',
    hint: 'Authenticate with AWS IAM creds — no raw API keys. Seeds Claude Sonnet 4.6 as the default chat + flows model.',
  },
  {
    label: 'Google Vertex AI (Gemini via service account)',
    value: 'vertex',
    hint: 'Authenticate with a GCP service account / workload identity — no API keys. Seeds gemini-2.5-pro chat + text-embedding-005 embeddings + Imagen, all on Vertex.',
  },
  {
    label: 'Both — Ollama (local) + AWS Bedrock Claude (default chat)',
    value: 'both',
    hint: 'TWO selectable chat models — local gpt-oss:20b + Claude Sonnet 4.6 (the default), Ollama embeddings, all via AWS IAM (no raw keys). Starts Ollama too.',
  },
  {
    label: 'Skip for now — configure later from the admin panel',
    value: 'skip',
    hint: 'Stack will boot, but chat/embedding calls will fail until you wire a provider. Nothing auto-starts.',
  },
];

export const LlmStrategyStep: React.FC<Props> = ({ step, total, onPick }) => (
  <Screen step={step} total={total} title="Which LLM provider should the platform use?">
    <Box flexDirection="column">
      <Hint>Pick the provider that powers chat completions and embeddings. Nothing is pre-selected.</Hint>
      <Hint>The platform never starts or assumes a provider — only the one you choose here is configured.</Hint>
      <Hint>Cloud-management creds (Azure / AWS / GCP) are a separate step further down.</Hint>
      <Box marginTop={1}>
        <SelectInput
          items={ITEMS.map((i) => ({ label: i.label, value: i.value }))}
          onSelect={(i) => {
            const v = i.value as LlmStrategy;
            // The sentinel is not a real choice — ignore it so the user can't
            // advance without explicitly picking a provider (no silent default).
            if (v === 'none') return;
            onPick(v);
          }}
          indicatorComponent={({ isSelected }) => (
            <Text color={COLORS.accent}>{isSelected ? '❯ ' : '  '}</Text>
          )}
        />
      </Box>
      <Box marginTop={1} flexDirection="column">
        {ITEMS.filter((i) => i.value !== 'none').map((i) => (
          <Text key={i.value} color={COLORS.muted}>
            {'  '}
            <Text bold>{i.label.split(' — ')[0]}</Text> — {i.hint}
          </Text>
        ))}
      </Box>
    </Box>
  </Screen>
);
