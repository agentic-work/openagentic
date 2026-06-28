import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { Screen, Hint, COLORS } from '../ui/Theme.tsx';
import type { WizardConfig } from '../lib/types.ts';

/**
 * Hugging Face provider step — a Hugging Face Inference Endpoint / TGI server,
 * chosen via LlmStrategy 'huggingface'. These are OpenAI-compatible, so the
 * platform wires them through the OpenAI adapter with a custom base URL (carried
 * in BOOTSTRAP_PROVIDER_CONFIG.baseUrl). Emits `providers.huggingface`.
 *
 *   endpointUrl — HF Inference Endpoint / TGI base URL, OpenAI-compatible (required).
 *   token       — HF access token, used as the OpenAI bearer (required).
 *   model       — served model name (required).
 */

interface Props {
  initial: WizardConfig['providers'];
  step: number;
  total: number;
  onDone: (providers: WizardConfig['providers']) => void;
}

export const HuggingFaceStep: React.FC<Props> = ({ initial, step, total, onDone }) => {
  const seed = initial.huggingface;
  const [endpointUrl, setEndpointUrl] = useState<string>(seed?.endpointUrl || '');
  const [token, setToken] = useState<string>(seed?.token || '');
  const [model, setModel] = useState<string>(seed?.model || '');
  const [fieldIdx, setFieldIdx] = useState(0);

  const finish = () => {
    onDone({
      huggingface: {
        endpointUrl: endpointUrl.trim(),
        token,
        model: model.trim(),
      },
    });
  };

  const fields = [
    { key: 'endpointUrl', label: 'Endpoint URL  ', value: endpointUrl, set: setEndpointUrl, mask: false, placeholder: 'https://xxxx.endpoints.huggingface.cloud/v1', required: true },
    { key: 'token',       label: 'HF token      ', value: token, set: setToken, mask: true, placeholder: '', required: true },
    { key: 'model',       label: 'Served model  ', value: model, set: setModel, mask: false, placeholder: 'meta-llama/Meta-Llama-3-8B-Instruct', required: true },
  ];
  const cur = fields[fieldIdx];
  const curRequiredEmpty = !!cur.required && !cur.value.trim();
  const advance = () => {
    if (curRequiredEmpty) return;
    if (fieldIdx + 1 < fields.length) setFieldIdx(fieldIdx + 1);
    else finish();
  };

  return (
    <Screen step={step} total={total} title="Hugging Face — your Inference Endpoint / TGI server">
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
          <Hint>OpenAI-compatible: wired through the OpenAI adapter with this base URL. The token is written to .env as OPENAI_API_KEY.</Hint>
        </Box>
        {curRequiredEmpty && (
          <Box>
            <Text color={COLORS.accent}>● required — enter the {cur.key === 'endpointUrl' ? 'endpoint URL' : cur.key === 'token' ? 'HF token' : 'served model name'} to continue</Text>
          </Box>
        )}
      </Box>
    </Screen>
  );
};
