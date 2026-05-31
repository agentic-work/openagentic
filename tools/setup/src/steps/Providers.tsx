import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { Screen, Hint, COLORS } from '../ui/Theme.tsx';
import type { WizardConfig } from '../lib/types.ts';

const FIELDS = [
  { key: 'anthropic', label: 'Anthropic API key          ' },
  { key: 'openai', label: 'OpenAI API key             ' },
  { key: 'google', label: 'Google AI API key          ' },
  { key: 'azureOpenAIEndpoint', label: 'Azure OpenAI endpoint      ' },
  { key: 'azureOpenAIKey', label: 'Azure OpenAI API key       ' },
] as const;

interface Props {
  initial: WizardConfig['providers'];
  step: number;
  total: number;
  onDone: (providers: WizardConfig['providers']) => void;
}

export const ProvidersStep: React.FC<Props> = ({ initial, step, total, onDone }) => {
  const [values, setValues] = useState<Record<string, string>>({ ...initial } as Record<string, string>);
  const [idx, setIdx] = useState(0);
  const current = FIELDS[idx];

  useInput((input, key) => {
    if (key.tab || (key.ctrl && input === 'd')) {
      onDone(values as WizardConfig['providers']);
    }
  });

  const next = () => {
    if (idx + 1 < FIELDS.length) setIdx(idx + 1);
    else onDone(values as WizardConfig['providers']);
  };

  return (
    <Screen step={step} total={total} title="LLM providers (all optional)">
      <Box flexDirection="column">
        {FIELDS.map((f, i) => (
          <Box key={f.key}>
            <Text color={i === idx ? COLORS.accent : COLORS.muted}>
              {i === idx ? '❯ ' : '  '}
              {f.label}:
            </Text>
            <Text>{' '}</Text>
            {i === idx ? (
              <TextInput
                value={values[f.key] || ''}
                onChange={(v) => setValues({ ...values, [f.key]: v })}
                onSubmit={next}
                mask={f.key.toLowerCase().includes('key') ? '•' : undefined}
              />
            ) : (
              <Text>
                {values[f.key] ? (f.key.toLowerCase().includes('key') ? '•'.repeat(Math.min(values[f.key].length, 20)) : values[f.key]) : ''}
              </Text>
            )}
          </Box>
        ))}
        <Box marginTop={1}>
          <Hint>Press Tab or Ctrl+D to skip the rest. You can add more later from the admin panel.</Hint>
        </Box>
        <Box marginTop={1}>
          <Hint>Supports static API keys for Anthropic, OpenAI, Azure, Google, AWS Bedrock, and Ollama.</Hint>
        </Box>
      </Box>
    </Screen>
  );
};
