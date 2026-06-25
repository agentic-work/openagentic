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
 * Azure AI Foundry provider step — models via the user's Azure endpoint. The
 * user enters the endpoint URL, then authenticates with EITHER an API key, a
 * Microsoft Entra app (tenant + client + secret), OR their current az login
 * (DefaultAzureCredential from the mounted ~/.azure — offered only when
 * detected), then picks an API version and a deployment / model name. Emits
 * `providers.azureFoundry`.
 *
 * Auth modes:
 *   1. API key                   → authMode='apikey', apiKey.
 *   2. Microsoft Entra app       → authMode='entra', tenantId + clientId + clientSecret.
 *   3. Use my current az login   → authMode='azlogin' (mounted ~/.azure).
 *      (offered only when ~/.azure exists on the host)
 */

const HOME = os.homedir();
const exists = (p: string) => {
  try { return fs.existsSync(path.join(HOME, p)); } catch { return false; }
};
const hasHostAzure = (): boolean => exists('.azure');

const DEFAULT_API_VERSION = '2024-10-21';

type AuthMode = 'apikey' | 'entra' | 'azlogin';

interface Props {
  initial: WizardConfig['providers'];
  step: number;
  total: number;
  onDone: (providers: WizardConfig['providers']) => void;
}

type Phase = 'endpoint' | 'mode' | 'apikey' | 'entra' | 'common';

export const AzureFoundryStep: React.FC<Props> = ({ initial, step, total, onDone }) => {
  const azureAvailable = hasHostAzure();
  const seed = initial.azureFoundry;
  const initialMode: AuthMode = seed?.authMode
    ? seed.authMode
    : (azureAvailable ? 'azlogin' : 'apikey');

  const [phase, setPhase] = useState<Phase>('endpoint');
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [endpointUrl, setEndpointUrl] = useState<string>(seed?.endpointUrl || '');
  const [apiKey, setApiKey] = useState<string>(seed?.apiKey || '');
  const [tenantId, setTenantId] = useState<string>(seed?.tenantId || '');
  const [clientId, setClientId] = useState<string>(seed?.clientId || '');
  const [clientSecret, setClientSecret] = useState<string>(seed?.clientSecret || '');
  // apiVersion starts EMPTY (unless seeded). The default shows as a placeholder
  // and is adopted on an empty Enter (finish() falls back).
  const [apiVersion, setApiVersion] = useState<string>(seed?.apiVersion || '');
  const [deploymentName, setDeploymentName] = useState<string>(seed?.deploymentName || '');
  const [fieldIdx, setFieldIdx] = useState(0);

  const finish = () => {
    const azureFoundry: NonNullable<WizardConfig['providers']['azureFoundry']> = {
      authMode: mode,
      endpointUrl: endpointUrl.trim(),
      apiVersion: apiVersion.trim() || DEFAULT_API_VERSION,
      deploymentName: deploymentName.trim(),
    };
    if (mode === 'apikey') {
      azureFoundry.apiKey = apiKey;
    } else if (mode === 'entra') {
      azureFoundry.tenantId = tenantId.trim();
      azureFoundry.clientId = clientId.trim();
      azureFoundry.clientSecret = clientSecret;
    }
    onDone({ azureFoundry });
  };

  // ── Phase: endpoint URL (required) ─────────────────────────────────────
  if (phase === 'endpoint') {
    return (
      <Screen step={step} total={total} title="Azure AI Foundry — models via your Azure endpoint">
        <Box flexDirection="column">
          <Box>
            <Text color={COLORS.accent}>❯ Endpoint URL: </Text>
            <TextInput
              value={endpointUrl}
              placeholder="https://my-foundry.cognitiveservices.azure.com"
              onChange={setEndpointUrl}
              onSubmit={() => { if (endpointUrl.trim()) { setMode(initialMode); setPhase('mode'); } }}
            />
          </Box>
          <Box marginTop={1}>
            <Hint>Your Azure AI Foundry endpoint URL (required).</Hint>
          </Box>
          {!endpointUrl.trim() && (
            <Box>
              <Text color={COLORS.accent}>● required — enter the endpoint URL to continue</Text>
            </Box>
          )}
        </Box>
      </Screen>
    );
  }

  // ── Phase: pick auth mode ──────────────────────────────────────────────
  if (phase === 'mode') {
    const items: Array<{ label: string; value: AuthMode }> = [
      { label: 'API key', value: 'apikey' },
      { label: 'Microsoft Entra app (tenant + client + secret)', value: 'entra' },
    ];
    if (azureAvailable) {
      items.push({ label: 'Use my current az login (~/.azure — mounted read-only)', value: 'azlogin' });
    }
    return (
      <Screen step={step} total={total} title="Azure AI Foundry — authentication">
        <Box flexDirection="column">
          <Hint>Pick how the platform authenticates to your Azure AI Foundry endpoint.</Hint>
          {azureAvailable && <Hint>Detected ~/.azure — your current az login is available.</Hint>}
          <Box marginTop={1}>
            <SelectInput
              items={items.map((i) => ({ label: i.label, value: i.value }))}
              initialIndex={Math.max(0, items.findIndex((i) => i.value === mode))}
              onSelect={(i) => {
                const m = i.value as AuthMode;
                setMode(m);
                setFieldIdx(0);
                setPhase(m === 'apikey' ? 'apikey' : m === 'entra' ? 'entra' : 'common');
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

  // ── Phase: API key ─────────────────────────────────────────────────────
  if (phase === 'apikey') {
    return (
      <Screen step={step} total={total} title="Azure AI Foundry — API key">
        <Box flexDirection="column">
          <Box>
            <Text color={COLORS.accent}>❯ API key: </Text>
            <TextInput
              value={apiKey}
              mask="•"
              onChange={setApiKey}
              onSubmit={() => { if (apiKey.trim()) { setFieldIdx(0); setPhase('common'); } }}
            />
          </Box>
          <Box marginTop={1}>
            <Hint>Written to .env as AIF_API_KEY.</Hint>
          </Box>
          {!apiKey.trim() && (
            <Box>
              <Text color={COLORS.accent}>● required — paste your API key to continue</Text>
            </Box>
          )}
        </Box>
      </Screen>
    );
  }

  // ── Phase: Microsoft Entra app (tenant + client + secret) ──────────────
  if (phase === 'entra') {
    const entraFields = [
      { key: 'tenantId', label: 'Tenant id     ', value: tenantId, set: setTenantId, mask: false },
      { key: 'clientId', label: 'Client id     ', value: clientId, set: setClientId, mask: false },
      { key: 'clientSecret', label: 'Client secret ', value: clientSecret, set: setClientSecret, mask: true },
    ];
    const cur = entraFields[fieldIdx];
    const curRequiredEmpty = !cur.value.trim();
    const advance = () => {
      if (curRequiredEmpty) return;
      if (fieldIdx + 1 < entraFields.length) setFieldIdx(fieldIdx + 1);
      else { setFieldIdx(0); setPhase('common'); }
    };
    return (
      <Screen step={step} total={total} title="Azure AI Foundry — Microsoft Entra app">
        <Box flexDirection="column">
          {entraFields.map((f, i) => (
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
            <Hint>Written to .env as AIF_TENANT_ID / AIF_CLIENT_ID / AIF_CLIENT_SECRET.</Hint>
          </Box>
          {curRequiredEmpty && (
            <Box>
              <Text color={COLORS.accent}>● required — enter the {cur.key === 'clientSecret' ? 'client secret' : cur.key === 'clientId' ? 'client id' : 'tenant id'} to continue</Text>
            </Box>
          )}
        </Box>
      </Screen>
    );
  }

  // ── Phase: common (api version + deployment / model name) ──────────────
  // phase === 'common'
  const fields = [
    { key: 'apiVersion',     label: 'API version          ', value: apiVersion, set: setApiVersion, placeholder: DEFAULT_API_VERSION, required: false },
    { key: 'deploymentName', label: 'Deployment / model   ', value: deploymentName, set: setDeploymentName, placeholder: 'gpt-4o', required: true },
  ];
  const cur = fields[fieldIdx];
  const curRequiredEmpty = !!cur.required && !cur.value.trim();
  const advance = () => {
    if (curRequiredEmpty) return;
    if (fieldIdx + 1 < fields.length) setFieldIdx(fieldIdx + 1);
    else finish();
  };
  return (
    <Screen step={step} total={total} title="Azure AI Foundry — deployment">
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
              <Text color={f.value ? undefined : COLORS.muted}>{f.value || f.placeholder || ''}</Text>
            )}
          </Box>
        ))}
        <Box marginTop={1}>
          <Hint>API version defaults to {DEFAULT_API_VERSION}. The deployment / model name is the chat model.</Hint>
        </Box>
        {curRequiredEmpty && (
          <Box>
            <Text color={COLORS.accent}>● required — enter the deployment / model name to continue</Text>
          </Box>
        )}
      </Box>
    </Screen>
  );
};
