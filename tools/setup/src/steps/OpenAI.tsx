import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { Screen, Hint, COLORS } from '../ui/Theme.tsx';
import type { WizardConfig } from '../lib/types.ts';

/**
 * OpenAI provider step — models via the official OpenAI API, chosen via
 * LlmStrategy 'openai'. The user pastes an API key and picks a chat model.
 * Emits `providers.openai`.
 *
 *   apiKey — OpenAI API key (required, written to .env as OPENAI_API_KEY).
 *   model  — OpenAI chat model id (default gpt-4o-mini).
 */

const DEFAULT_MODEL = 'gpt-4o-mini';

interface Props {
  initial: WizardConfig['providers'];
  step: number;
  total: number;
  onDone: (providers: WizardConfig['providers']) => void;
}

export const OpenAIStep: React.FC<Props> = ({ initial, step, total, onDone }) => {
  const seed = initial.openai;
  const [apiKey, setApiKey] = useState<string>(seed?.apiKey || '');
  // model starts EMPTY (unless seeded); the default shows as a placeholder and
  // is adopted on an empty Enter, so typing never appends to a pre-filled value.
  const [model, setModel] = useState<string>(seed?.model || '');
  const [fieldIdx, setFieldIdx] = useState(0);

  const finish = () => {
    onDone({
      openai: {
        apiKey,
        model: model.trim() || DEFAULT_MODEL,
      },
    });
  };

  const fields = [
    { key: 'apiKey', label: 'OpenAI API key   ', value: apiKey, set: setApiKey, mask: true, placeholder: '', required: true },
    { key: 'model',  label: 'Chat model       ', value: model, set: setModel, mask: false, placeholder: DEFAULT_MODEL, required: false },
  ];
  const cur = fields[fieldIdx];
  const curRequiredEmpty = !!cur.required && !cur.value.trim();
  const advance = () => {
    if (curRequiredEmpty) return;
    if (fieldIdx + 1 < fields.length) setFieldIdx(fieldIdx + 1);
    else finish();
  };

  return (
    <Screen step={step} total={total} title="OpenAI — models via the OpenAI API">
      <Box flexDirection="column">
        {fields.map((f, i) => (
          <Box key={f.key}>
            <Text color={i === fieldIdx ? COLORS.accent : COLORS.muted}>
              {i === fieldIdx ? '❯ ' : '  '}
              {f.label}:
            </Text>
            <Text>{' '}</Text>
            {i === fieldIdx ? (
              <TextInput
                value={f.value}
                placeholder={f.mask ? undefined : f.placeholder}
                onChange={f.set}
                onSubmit={advance}
                mask={f.mask ? '•' : undefined}
              />
            ) : (
              <Text color={f.value ? undefined : COLORS.muted}>
                {f.value ? (f.mask ? '•'.repeat(Math.min(f.value.length, 20)) : f.value) : (f.mask ? '' : f.placeholder)}
              </Text>
            )}
          </Box>
        ))}
        <Box marginTop={1}>
          <Hint>The API key is written to .env as OPENAI_API_KEY. The chat model defaults to {DEFAULT_MODEL}.</Hint>
        </Box>
        {curRequiredEmpty && (
          <Box>
            <Text color={COLORS.accent}>● required — paste your OpenAI API key to continue</Text>
          </Box>
        )}
      </Box>
    </Screen>
  );
};
