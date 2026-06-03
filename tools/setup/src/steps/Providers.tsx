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
 * Cloud-LLM provider step. Per the firm product decision, cloud LLMs
 * authenticate via AWS IAM ONLY — there are no raw provider API-key fields
 * anymore. The only cloud option is AWS Bedrock (Claude). This step collects
 * the AWS region + how to authenticate, then emits `providers.awsBedrock`.
 *
 * Auth modes, in priority order (mirrors the host-creds pattern in lib/mcps.ts):
 *   1. Use my host AWS creds (~/.aws)  → useHostCreds=true, region only.
 *   2. Enter IAM access key/secret     → region + accessKeyId + secretAccessKey.
 *   3. Use a named AWS profile         → region + profile.
 * The host-creds option is only offered when ~/.aws actually exists.
 */

const HOME = os.homedir();
const exists = (p: string) => {
  try { return fs.existsSync(path.join(HOME, p)); } catch { return false; }
};
const hasHostAwsCreds = (): boolean =>
  exists('.aws/credentials') || exists('.aws/config');

const DEFAULT_REGION = 'us-east-1';

type AuthMode = 'host' | 'inline' | 'profile';

interface Props {
  initial: WizardConfig['providers'];
  step: number;
  total: number;
  onDone: (providers: WizardConfig['providers']) => void;
}

type Phase = 'mode' | 'region' | 'inline' | 'profile';

export const ProvidersStep: React.FC<Props> = ({ initial, step, total, onDone }) => {
  const hostAvailable = hasHostAwsCreds();
  const seed = initial.awsBedrock;
  // Pre-select a mode from any prior config so re-running the wizard is sticky.
  const initialMode: AuthMode = seed?.useHostCreds
    ? 'host'
    : seed?.profile
      ? 'profile'
      : seed?.accessKeyId
        ? 'inline'
        : (hostAvailable ? 'host' : 'inline');

  const [phase, setPhase] = useState<Phase>('mode');
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [region, setRegion] = useState<string>(seed?.region || DEFAULT_REGION);
  const [accessKeyId, setAccessKeyId] = useState<string>(seed?.accessKeyId || '');
  const [secretAccessKey, setSecretAccessKey] = useState<string>(seed?.secretAccessKey || '');
  const [profile, setProfile] = useState<string>(seed?.profile || 'default');
  // Sub-field index for the multi-field phases (inline / profile).
  const [fieldIdx, setFieldIdx] = useState(0);

  const finish = (m: AuthMode, regionVal: string) => {
    const r = regionVal.trim() || DEFAULT_REGION;
    const awsBedrock: NonNullable<WizardConfig['providers']['awsBedrock']> = { region: r };
    if (m === 'host') {
      awsBedrock.useHostCreds = true;
    } else if (m === 'inline') {
      awsBedrock.accessKeyId = accessKeyId.trim();
      awsBedrock.secretAccessKey = secretAccessKey;
    } else if (m === 'profile') {
      awsBedrock.profile = profile.trim() || 'default';
    }
    onDone({ awsBedrock });
  };

  // ── Phase: pick auth mode ──────────────────────────────────────────────
  if (phase === 'mode') {
    const items: Array<{ label: string; value: AuthMode }> = [];
    if (hostAvailable) {
      items.push({ label: 'Use my host AWS creds (~/.aws — mounted read-only)', value: 'host' });
    }
    items.push({ label: 'Enter IAM access key / secret inline', value: 'inline' });
    items.push({ label: 'Use a named AWS profile', value: 'profile' });

    return (
      <Screen step={step} total={total} title="AWS Bedrock (Claude via IAM)">
        <Box flexDirection="column">
          <Hint>Cloud LLMs authenticate with AWS IAM — no raw provider API keys.</Hint>
          <Hint>Claude Sonnet 4.6 becomes the default chat + flows model.</Hint>
          {hostAvailable ? (
            <Hint>Detected AWS credentials in ~/.aws — host creds are the easy path.</Hint>
          ) : (
            <Hint>No ~/.aws found on this machine — paste IAM keys or name a profile.</Hint>
          )}
          <Box marginTop={1}>
            <SelectInput
              items={items.map((i) => ({ label: i.label, value: i.value }))}
              initialIndex={Math.max(0, items.findIndex((i) => i.value === mode))}
              onSelect={(i) => {
                const m = i.value as AuthMode;
                setMode(m);
                setFieldIdx(0);
                setPhase(m === 'host' ? 'region' : m === 'inline' ? 'inline' : 'profile');
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

  // ── Phase: region only (host-creds path) ──────────────────────────────
  if (phase === 'region') {
    return (
      <Screen step={step} total={total} title="AWS Bedrock — region">
        <Box flexDirection="column">
          <Box>
            <Text color={COLORS.accent}>❯ AWS region: </Text>
            <TextInput
              value={region}
              onChange={setRegion}
              onSubmit={() => finish('host', region)}
            />
          </Box>
          <Box marginTop={1}>
            <Hint>Default us-east-1. Your host ~/.aws creds will be mounted read-only into the api.</Hint>
          </Box>
        </Box>
      </Screen>
    );
  }

  // ── Phase: inline IAM keys (region + accessKeyId + secret) ─────────────
  if (phase === 'inline') {
    const fields = [
      { key: 'region', label: 'AWS region                ', value: region, set: setRegion, mask: false },
      { key: 'accessKeyId', label: 'AWS access key id          ', value: accessKeyId, set: setAccessKeyId, mask: false },
      { key: 'secretAccessKey', label: 'AWS secret access key      ', value: secretAccessKey, set: setSecretAccessKey, mask: true },
    ];
    const cur = fields[fieldIdx];
    const curRequiredEmpty =
      (cur.key === 'accessKeyId' || cur.key === 'secretAccessKey') && !cur.value.trim();
    const advance = () => {
      // accessKeyId + secret are required on the inline path — refuse to advance
      // (and refuse to finish) while blank, so the user can't silently fall back
      // to a region-only/host-creds config with no credentials.
      if (curRequiredEmpty) return;
      if (fieldIdx + 1 < fields.length) setFieldIdx(fieldIdx + 1);
      else finish('inline', region);
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
                  onChange={f.set}
                  onSubmit={advance}
                  mask={f.mask ? '•' : undefined}
                />
              ) : (
                <Text>{f.value ? (f.mask ? '•'.repeat(Math.min(f.value.length, 20)) : f.value) : ''}</Text>
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
  }

  // ── Phase: named profile (region + profile) ────────────────────────────
  // phase === 'profile'
  const fields = [
    { key: 'region', label: 'AWS region    ', value: region, set: setRegion },
    { key: 'profile', label: 'AWS profile   ', value: profile, set: setProfile },
  ];
  const advance = () => {
    if (fieldIdx + 1 < fields.length) setFieldIdx(fieldIdx + 1);
    else finish('profile', region);
  };
  return (
    <Screen step={step} total={total} title="AWS Bedrock — named profile">
      <Box flexDirection="column">
        {fields.map((f, i) => (
          <Box key={f.key}>
            <Text color={i === fieldIdx ? COLORS.accent : COLORS.muted}>
              {i === fieldIdx ? '❯ ' : '  '}
              {f.label}:
            </Text>
            <Text>{' '}</Text>
            {i === fieldIdx ? (
              <TextInput value={f.value} onChange={f.set} onSubmit={advance} />
            ) : (
              <Text>{f.value}</Text>
            )}
          </Box>
        ))}
        <Box marginTop={1}>
          <Hint>The named profile resolves from your host ~/.aws (mounted read-only into the api).</Hint>
        </Box>
      </Box>
    </Screen>
  );
};
