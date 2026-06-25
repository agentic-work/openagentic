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
 * AWS Bedrock provider step — models served via the user's AWS account. The
 * user authenticates EITHER with their current AWS login (the mounted host
 * ~/.aws — offered only when detected) OR with pregenerated IAM keys, then
 * picks a region and a Bedrock chat model. Emits `providers.bedrock`.
 *
 * Auth modes:
 *   1. Use my current AWS login (~/.aws)  → authMode='awslogin', region + model.
 *      (offered only when ~/.aws exists on the host)
 *   2. Enter IAM access key + secret      → authMode='keys', region + keys + model.
 */

const HOME = os.homedir();
const exists = (p: string) => {
  try { return fs.existsSync(path.join(HOME, p)); } catch { return false; }
};
const hasHostAwsCreds = (): boolean =>
  exists('.aws/credentials') || exists('.aws/config');

const DEFAULT_REGION = 'us-east-1';
const DEFAULT_MODEL = 'amazon.nova-pro-v1:0';

type AuthMode = 'awslogin' | 'keys';

interface Props {
  initial: WizardConfig['providers'];
  step: number;
  total: number;
  onDone: (providers: WizardConfig['providers']) => void;
}

type Phase = 'mode' | 'awslogin' | 'keys';

export const ProvidersStep: React.FC<Props> = ({ initial, step, total, onDone }) => {
  const hostAvailable = hasHostAwsCreds();
  const seed = initial.bedrock;
  // Pre-select a mode from any prior config so re-running the wizard is sticky.
  const initialMode: AuthMode = seed?.authMode
    ? seed.authMode
    : (hostAvailable ? 'awslogin' : 'keys');

  const [phase, setPhase] = useState<Phase>('mode');
  const [mode, setMode] = useState<AuthMode>(initialMode);
  // region/model start EMPTY (unless seeded from a prior .env). The default is
  // shown as a placeholder and adopted on an empty Enter (finish() falls back),
  // so typing a value never appends to a pre-filled string (the doubled-value
  // footgun).
  const [region, setRegion] = useState<string>(seed?.region || '');
  const [accessKeyId, setAccessKeyId] = useState<string>(seed?.accessKeyId || '');
  const [secretAccessKey, setSecretAccessKey] = useState<string>(seed?.secretAccessKey || '');
  const [model, setModel] = useState<string>(seed?.model || '');
  // Sub-field index for the multi-field phases.
  const [fieldIdx, setFieldIdx] = useState(0);

  const finish = (m: AuthMode) => {
    const r = region.trim() || DEFAULT_REGION;
    const mdl = model.trim() || DEFAULT_MODEL;
    const bedrock: NonNullable<WizardConfig['providers']['bedrock']> = {
      authMode: m,
      region: r,
      model: mdl,
    };
    if (m === 'keys') {
      bedrock.accessKeyId = accessKeyId.trim();
      bedrock.secretAccessKey = secretAccessKey;
    }
    onDone({ bedrock });
  };

  // ── Phase: pick auth mode ──────────────────────────────────────────────
  if (phase === 'mode') {
    const items: Array<{ label: string; value: AuthMode }> = [];
    if (hostAvailable) {
      items.push({ label: 'Use my current AWS login (~/.aws — mounted read-only)', value: 'awslogin' });
    }
    items.push({ label: 'Enter IAM access key + secret', value: 'keys' });

    return (
      <Screen step={step} total={total} title="AWS Bedrock — models via your AWS account">
        <Box flexDirection="column">
          <Hint>Pick how the platform authenticates to your AWS account for Bedrock.</Hint>
          {hostAvailable ? (
            <Hint>Detected AWS credentials in ~/.aws — your current login is the easy path.</Hint>
          ) : (
            <Hint>No ~/.aws found on this machine — paste an IAM access key + secret.</Hint>
          )}
          <Box marginTop={1}>
            <SelectInput
              items={items.map((i) => ({ label: i.label, value: i.value }))}
              initialIndex={Math.max(0, items.findIndex((i) => i.value === mode))}
              onSelect={(i) => {
                const m = i.value as AuthMode;
                setMode(m);
                setFieldIdx(0);
                setPhase(m === 'awslogin' ? 'awslogin' : 'keys');
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

  // ── Phase: current AWS login (region + model) ─────────────────────────
  if (phase === 'awslogin') {
    const fields = [
      { key: 'region', label: 'AWS region          ', value: region, set: setRegion, placeholder: DEFAULT_REGION },
      { key: 'model',  label: 'Bedrock chat model  ', value: model, set: setModel, placeholder: DEFAULT_MODEL },
    ];
    const advance = () => {
      if (fieldIdx + 1 < fields.length) setFieldIdx(fieldIdx + 1);
      else finish('awslogin');
    };
    return (
      <Screen step={step} total={total} title="AWS Bedrock — current AWS login">
        <Box flexDirection="column">
          {fields.map((f, i) => (
            <Box key={f.key}>
              <Text color={i === fieldIdx ? COLORS.accent : COLORS.muted}>
                {i === fieldIdx ? '❯ ' : '  '}
                {f.label}:
              </Text>
              <Text>{' '}</Text>
              {i === fieldIdx ? (
                <TextInput value={f.value} placeholder={f.placeholder} onChange={f.set} onSubmit={advance} />
              ) : (
                <Text color={f.value ? undefined : COLORS.muted}>{f.value || f.placeholder}</Text>
              )}
            </Box>
          ))}
          <Box marginTop={1}>
            <Hint>Your host ~/.aws is mounted read-only into the api; the default credential chain resolves it.</Hint>
          </Box>
        </Box>
      </Screen>
    );
  }

  // ── Phase: inline IAM keys (region + accessKeyId + secret + model) ─────
  // phase === 'keys'
  const fields = [
    { key: 'region', label: 'AWS region                ', value: region, set: setRegion, mask: false, placeholder: DEFAULT_REGION },
    { key: 'accessKeyId', label: 'AWS access key id          ', value: accessKeyId, set: setAccessKeyId, mask: false, placeholder: 'AKIA…' },
    { key: 'secretAccessKey', label: 'AWS secret access key      ', value: secretAccessKey, set: setSecretAccessKey, mask: true, placeholder: '' },
    { key: 'model', label: 'Bedrock chat model         ', value: model, set: setModel, mask: false, placeholder: DEFAULT_MODEL },
  ];
  const cur = fields[fieldIdx];
  const curRequiredEmpty =
    (cur.key === 'accessKeyId' || cur.key === 'secretAccessKey') && !cur.value.trim();
  const advance = () => {
    // accessKeyId + secret are required on the keys path — refuse to advance
    // (and refuse to finish) while blank, so the user can't silently fall back
    // to a region-only config with no credentials.
    if (curRequiredEmpty) return;
    if (fieldIdx + 1 < fields.length) setFieldIdx(fieldIdx + 1);
    else finish('keys');
  };
  return (
    <Screen step={step} total={total} title="AWS Bedrock — IAM access key">
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
          <Hint>Inline IAM keys are written to .env as AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.</Hint>
        </Box>
        {curRequiredEmpty && (
          <Box>
            <Text color={COLORS.accent}>● required — paste your IAM {cur.key === 'secretAccessKey' ? 'secret' : 'access key'} to continue</Text>
          </Box>
        )}
      </Box>
    </Screen>
  );
};
