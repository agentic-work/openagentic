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
// A sensible default SA-key location to pre-fill when one is detectable.
const detectSaKey = (): string => {
  const dir = path.join(HOME, '.config', 'gcloud', 'keys');
  try {
    const hit = fs.readdirSync(dir).find((f) => f.endsWith('.json'));
    if (hit) return path.join(dir, hit);
  } catch { /* no keys dir */ }
  return '';
};

const FIELDS = [
  { key: 'project',    label: 'GCP project id      ', placeholder: 'my-gcp-project', required: true },
  { key: 'region',     label: 'Region              ', placeholder: 'us-central1', required: false },
  { key: 'chatModel',  label: 'Chat model          ', placeholder: 'gemini-2.5-pro', required: false },
  { key: 'embedModel', label: 'Embedding model     ', placeholder: 'text-embedding-005', required: false },
  { key: 'imageModel', label: 'Image model         ', placeholder: 'imagen-4.0-generate-001', required: false },
  { key: 'saKeyPath',  label: 'Service-account key ', placeholder: '~/.config/gcloud/keys/sa.json', required: true },
] as const;

interface Props {
  initial: WizardConfig['providers'];
  step: number;
  total: number;
  onDone: (providers: WizardConfig['providers']) => void;
}

export const VertexStep: React.FC<Props> = ({ initial, step, total, onDone }) => {
  const seed = initial.vertex;
  const [values, setValues] = useState<Record<string, string>>({
    project: seed?.project || '',
    region: seed?.region || 'us-central1',
    chatModel: seed?.chatModel || 'gemini-2.5-pro',
    embedModel: seed?.embedModel || 'text-embedding-005',
    imageModel: seed?.imageModel || 'imagen-4.0-generate-001',
    saKeyPath: seed?.saKeyPath || detectSaKey(),
  });
  const [idx, setIdx] = useState(0);
  const current = FIELDS[idx];
  const curRequiredEmpty = current.required && !values[current.key]?.trim();

  const finish = (v: Record<string, string>) =>
    onDone({
      vertex: {
        project: v.project.trim(),
        region: v.region.trim() || 'us-central1',
        chatModel: v.chatModel.trim() || 'gemini-2.5-pro',
        embedModel: v.embedModel.trim() || 'text-embedding-005',
        imageModel: v.imageModel.trim() || 'imagen-4.0-generate-001',
        saKeyPath: v.saKeyPath.trim(),
      },
    });

  useInput((input, key) => {
    // Ctrl+D finishes early, but only once the required fields are filled.
    if (key.ctrl && input === 'd' && values.project.trim() && values.saKeyPath.trim()) finish(values);
  });

  const advance = () => {
    if (curRequiredEmpty) return;  // refuse to leave a required field blank
    if (idx + 1 < FIELDS.length) setIdx(idx + 1);
    else finish(values);
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
          <Hint>No API keys — the api calls Vertex with the mounted service-account (ADC). Enter accepts each field.</Hint>
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
