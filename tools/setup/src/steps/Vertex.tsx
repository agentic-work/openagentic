import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Screen, Hint, COLORS } from '../ui/Theme.tsx';
import type { WizardConfig } from '../lib/types.ts';

/**
 * Google Vertex AI provider step — Gemini models via the user's GCP project.
 * The user authenticates EITHER with their current gcloud login (ADC from the
 * mounted host ~/.config/gcloud — offered only when detected) OR with a
 * pregenerated service-account JSON key, then picks a project, location, and a
 * Gemini chat model. Emits `providers.vertex`.
 *
 * Auth modes:
 *   1. Use my current gcloud login (ADC)  → authMode='adc', project + location + model.
 *      (offered only when ~/.config/gcloud exists on the host)
 *   2. Provide a service-account JSON key → authMode='sajson', + SA key path.
 */

const HOME = os.homedir();
const exists = (p: string) => {
  try { return fs.existsSync(path.join(HOME, p)); } catch { return false; }
};
const hasHostGcloud = (): boolean => exists('.config/gcloud');

// Detect a service-account key under ~/.config/gcloud/keys to offer as the
// default SA-key path (adopted on Enter).
const detectSaKey = (): string => {
  const dir = path.join(HOME, '.config', 'gcloud', 'keys');
  try {
    const hit = fs.readdirSync(dir).find((f) => f.endsWith('.json'));
    if (hit) return path.join(dir, hit);
  } catch { /* no keys dir */ }
  return '';
};

const DEFAULT_LOCATION = 'us-central1';
const DEFAULT_MODEL = 'gemini-1.5-pro';

type AuthMode = 'adc' | 'sajson';

interface Props {
  initial: WizardConfig['providers'];
  step: number;
  total: number;
  onDone: (providers: WizardConfig['providers']) => void;
}

type Phase = 'mode' | 'adc' | 'sajson';

export const VertexStep: React.FC<Props> = ({ initial, step, total, onDone }) => {
  const adcAvailable = hasHostGcloud();
  const seed = initial.vertex;
  const detected = detectSaKey();
  const initialMode: AuthMode = seed?.authMode
    ? seed.authMode
    : (adcAvailable ? 'adc' : 'sajson');

  const [phase, setPhase] = useState<Phase>('mode');
  const [mode, setMode] = useState<AuthMode>(initialMode);
  // location/model start EMPTY (unless seeded). The default shows as a
  // placeholder and is adopted on an empty Enter (finish() falls back), so
  // typing never appends to a pre-filled string (the doubled-value footgun).
  const [projectId, setProjectId] = useState<string>(seed?.projectId || '');
  const [location, setLocation] = useState<string>(seed?.location || '');
  const [model, setModel] = useState<string>(seed?.model || '');
  const [saKeyPath, setSaKeyPath] = useState<string>(seed?.saKeyPath || '');
  const [fieldIdx, setFieldIdx] = useState(0);

  const finish = (m: AuthMode) => {
    const vertex: NonNullable<WizardConfig['providers']['vertex']> = {
      authMode: m,
      projectId: projectId.trim(),
      location: location.trim() || DEFAULT_LOCATION,
      model: model.trim() || DEFAULT_MODEL,
    };
    if (m === 'sajson') {
      vertex.saKeyPath = (saKeyPath.trim() || detected);
    }
    onDone({ vertex });
  };

  // ── Phase: pick auth mode ──────────────────────────────────────────────
  if (phase === 'mode') {
    const items: Array<{ label: string; value: AuthMode }> = [];
    if (adcAvailable) {
      items.push({ label: 'Use my current gcloud login (ADC — ~/.config/gcloud, mounted read-only)', value: 'adc' });
    }
    items.push({ label: 'Provide a service-account JSON key', value: 'sajson' });

    return (
      <Screen step={step} total={total} title="Google Vertex AI — Gemini via your GCP project">
        <Box flexDirection="column">
          <Hint>Pick how the platform authenticates to your GCP project for Vertex AI.</Hint>
          {adcAvailable ? (
            <Hint>Detected ~/.config/gcloud — your current gcloud login (ADC) is the easy path.</Hint>
          ) : (
            <Hint>No ~/.config/gcloud found — provide a service-account JSON key path.</Hint>
          )}
          <Box marginTop={1}>
            <SelectInput
              items={items.map((i) => ({ label: i.label, value: i.value }))}
              initialIndex={Math.max(0, items.findIndex((i) => i.value === mode))}
              onSelect={(i) => {
                const m = i.value as AuthMode;
                setMode(m);
                setFieldIdx(0);
                setPhase(m === 'adc' ? 'adc' : 'sajson');
              }}
              indicatorComponent={({ isSelected }) => (
                <Text color={COLORS.accent}>{isSelected ? '❯ ' : '  '}</Text>
              )}
            />
          </Box>
        </Box>
      </Screen>
    );
  }

  // ── Common project/location/model fields, plus the SA-key field on sajson ──
  const fields: Array<{ key: string; label: string; value: string; set: (v: string) => void; placeholder?: string; required?: boolean }> = [
    { key: 'projectId', label: 'GCP project id      ', value: projectId, set: setProjectId, placeholder: 'my-gcp-project', required: true },
    { key: 'location',  label: 'Location            ', value: location, set: setLocation, placeholder: DEFAULT_LOCATION },
    { key: 'model',     label: 'Gemini chat model   ', value: model, set: setModel, placeholder: DEFAULT_MODEL },
  ];
  if (phase === 'sajson') {
    fields.push({
      key: 'saKeyPath',
      label: 'Service-account key ',
      value: saKeyPath,
      set: setSaKeyPath,
      placeholder: detected || '~/.config/gcloud/keys/sa.json',
      required: true,
    });
  }

  const cur = fields[fieldIdx];
  const curRequiredEmpty = !!cur.required && !cur.value.trim() &&
    !(cur.key === 'saKeyPath' && detected);
  const advance = () => {
    if (curRequiredEmpty) return;  // refuse to leave a required field with no value
    if (fieldIdx + 1 < fields.length) setFieldIdx(fieldIdx + 1);
    else finish(phase === 'adc' ? 'adc' : 'sajson');
  };

  return (
    <Screen
      step={step}
      total={total}
      title={phase === 'adc' ? 'Google Vertex AI — current gcloud login' : 'Google Vertex AI — service account'}
    >
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
                placeholder={f.placeholder}
                onChange={f.set}
                onSubmit={advance}
              />
            ) : (
              <Text color={f.value ? undefined : COLORS.muted}>
                {f.value || f.placeholder || ''}
              </Text>
            )}
          </Box>
        ))}
        <Box marginTop={1}>
          <Hint>
            {phase === 'adc'
              ? 'Your host ~/.config/gcloud is mounted read-only; Vertex calls resolve via ADC.'
              : 'The SA key is mounted read-only into the api; GOOGLE_APPLICATION_CREDENTIALS points at it.'}
          </Hint>
        </Box>
        {curRequiredEmpty && (
          <Box>
            <Text color={COLORS.accent}>● required — enter the {cur.key === 'projectId' ? 'GCP project id' : 'service-account key path'} to continue</Text>
          </Box>
        )}
      </Box>
    </Screen>
  );
};
