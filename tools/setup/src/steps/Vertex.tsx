import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Screen, Hint, COLORS } from '../ui/Theme.tsx';
import type { WizardConfig } from '../lib/types.ts';

/**
 * Google Vertex AI provider step — the GCP-native sibling of the AWS Bedrock
 * step. Authenticates with a service-account key (workload identity / ADC),
 * no API keys. Collects project + region + the three model ids (chat /
 * embedding / image) and the SA-key path, then emits `providers.vertex`.
 * Launch.toEnv() turns it into a `vertex-ai` bootstrap provider (gemini-2.5-pro
 * default chat) + the GCP_* embedding contract + the Imagen default, and the
 * compose api mounts the SA key read-only.
 */

const HOME = os.homedir();
// Detect a service-account key under ~/.config/gcloud/keys to offer as the
// default (adopted on Enter). Returned as a field DEFAULT, not pre-filled into
// the editable value — so typing a different path never appends to it.
const detectSaKey = (): string => {
  const dir = path.join(HOME, '.config', 'gcloud', 'keys');
  try {
    const hit = fs.readdirSync(dir).find((f) => f.endsWith('.json'));
    if (hit) return path.join(dir, hit);
  } catch { /* no keys dir */ }
  return '';
};

interface Props {
  initial: WizardConfig['providers'];
  step: number;
  total: number;
  onDone: (providers: WizardConfig['providers']) => void;
}

export const VertexStep: React.FC<Props> = ({ initial, step, total, onDone }) => {
  const seed = initial.vertex;
  const detected = detectSaKey();

  // Each field has a real `def` (adopted on an empty Enter) and an illustrative
  // `placeholder`. `project` has NO default — it must be typed. Editable values
  // start EMPTY (unless seeded from a prior .env) so typing a value never
  // appends to a pre-filled string (the doubled-path footgun).
  const FIELDS = [
    { key: 'project',    label: 'GCP project id      ', def: '',                        placeholder: 'my-gcp-project', required: true },
    { key: 'region',     label: 'Region              ', def: 'us-central1',             placeholder: 'us-central1', required: false },
    { key: 'chatModel',  label: 'Chat model          ', def: 'gemini-2.5-pro',          placeholder: 'gemini-2.5-pro', required: false },
    { key: 'embedModel', label: 'Embedding model     ', def: 'text-embedding-005',      placeholder: 'text-embedding-005', required: false },
    { key: 'imageModel', label: 'Image model         ', def: 'imagen-4.0-generate-001', placeholder: 'imagen-4.0-generate-001', required: false },
    { key: 'saKeyPath',  label: 'Service-account key ', def: detected,                  placeholder: detected || '~/.config/gcloud/keys/sa.json', required: true },
  ] as const;

  const [values, setValues] = useState<Record<string, string>>({
    project: seed?.project || '',
    region: seed?.region || '',
    chatModel: seed?.chatModel || '',
    embedModel: seed?.embedModel || '',
    imageModel: seed?.imageModel || '',
    saKeyPath: seed?.saKeyPath || '',
  });
  const [idx, setIdx] = useState(0);
  const current = FIELDS[idx];

  // Effective value: the typed value, else the field's real default.
  const resolve = (key: string): string => {
    const typed = (values[key] || '').trim();
    if (typed) return typed;
    return FIELDS.find((f) => f.key === key)?.def || '';
  };
  const requiredUnmet = (key: string): boolean => {
    const f = FIELDS.find((x) => x.key === key)!;
    return f.required && !resolve(key);
  };
  const curRequiredEmpty = requiredUnmet(current.key);

  const finish = () =>
    onDone({
      vertex: {
        project: resolve('project'),
        region: resolve('region') || 'us-central1',
        chatModel: resolve('chatModel') || 'gemini-2.5-pro',
        embedModel: resolve('embedModel') || 'text-embedding-005',
        imageModel: resolve('imageModel') || 'imagen-4.0-generate-001',
        saKeyPath: resolve('saKeyPath'),
      },
    });

  useInput((input, key) => {
    if (key.ctrl && input === 'd' && !requiredUnmet('project') && !requiredUnmet('saKeyPath')) finish();
  });

  const advance = () => {
    if (curRequiredEmpty) return;  // refuse to leave a required field with no value
    if (idx + 1 < FIELDS.length) setIdx(idx + 1);
    else finish();
  };

  return (
    <Screen step={step} total={total} title="Google Vertex AI (service account / ADC)">
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
                placeholder={f.placeholder}
                onChange={(v) => setValues({ ...values, [f.key]: v })}
                onSubmit={advance}
              />
            ) : (
              <Text color={values[f.key] ? undefined : COLORS.muted}>
                {values[f.key] || f.placeholder}
              </Text>
            )}
          </Box>
        ))}
        <Box marginTop={1}>
          <Hint>No API keys — the api calls Vertex with the mounted service-account (ADC). Enter accepts each default.</Hint>
        </Box>
        {curRequiredEmpty && (
          <Box>
            <Text color={COLORS.accent}>● required — enter the {current.key === 'project' ? 'GCP project id' : 'service-account key path'} to continue</Text>
          </Box>
        )}
      </Box>
    </Screen>
  );
};
