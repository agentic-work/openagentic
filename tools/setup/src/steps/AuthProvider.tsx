import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { Screen, Hint, COLORS } from '../ui/Theme.tsx';
import type { WizardConfig } from '../lib/types.ts';

interface Props {
  initial: WizardConfig['auth'];
  /** Used to default the Entra redirect URI to this instance. */
  uiPort: number;
  step: number;
  total: number;
  onDone: (auth: WizardConfig['auth']) => void;
}

type EntraField =
  | 'tenantId'
  | 'clientId'
  | 'clientSecret'
  | 'redirectUri'
  | 'userGroups'
  | 'adminGroups'
  | 'externalAdminEmails';

const ENTRA_FIELDS: { key: EntraField; label: string; mask?: boolean }[] = [
  { key: 'tenantId', label: 'tenant ID    ' },
  { key: 'clientId', label: 'client ID    ' },
  { key: 'clientSecret', label: 'client secret', mask: true },
  { key: 'redirectUri', label: 'redirect URI ' },
  { key: 'userGroups', label: 'user groups  ' },
  { key: 'adminGroups', label: 'admin groups ' },
  { key: 'externalAdminEmails', label: 'admin emails ' },
];

export const AuthProviderStep: React.FC<Props> = ({ initial, uiPort, step, total, onDone }) => {
  const [phase, setPhase] = useState<'choose' | 'entra'>('choose');
  const e = initial.entra;
  const [vals, setVals] = useState<Record<EntraField, string>>({
    tenantId: e?.tenantId || '',
    clientId: e?.clientId || '',
    clientSecret: e?.clientSecret || '',
    redirectUri: e?.redirectUri || `http://localhost:${uiPort}/api/auth/microsoft/callback`,
    userGroups: e?.userGroups || '',
    adminGroups: e?.adminGroups || '',
    externalAdminEmails: e?.externalAdminEmails || '',
  });
  const [idx, setIdx] = useState(0);

  if (phase === 'choose') {
    return (
      <Screen step={step} total={total} title="Authentication">
        <Box flexDirection="column">
          <SelectInput
            items={[
              { label: 'Local username / password  (default — single user, no external IdP)', value: 'local' },
              { label: 'Microsoft Entra ID (Azure AD) SSO  — directory users + groups', value: 'azure-ad' },
            ]}
            initialIndex={initial.provider === 'azure-ad' ? 1 : 0}
            onSelect={(item: { value: string }) => {
              if (item.value === 'local') onDone({ provider: 'local' });
              else setPhase('entra');
            }}
          />
          <Box marginTop={1}>
            <Hint>Entra SSO needs an Azure app registration. It also unlocks OBO cloud tools — run azure/aws/gcp as the signed-in user.</Hint>
          </Box>
        </Box>
      </Screen>
    );
  }

  const setVal = (v: string) => setVals((s) => ({ ...s, [ENTRA_FIELDS[idx].key]: v }));
  const advance = () => {
    if (idx < ENTRA_FIELDS.length - 1) {
      setIdx(idx + 1);
    } else if (vals.tenantId && vals.clientId && vals.clientSecret) {
      onDone({ provider: 'azure-ad', entra: { ...vals } });
    }
  };

  return (
    <Screen step={step} total={total} title="Microsoft Entra ID (Azure AD)">
      <Box flexDirection="column">
        {ENTRA_FIELDS.map((f, i) => (
          <Box key={f.key}>
            <Text color={i === idx ? COLORS.accent : COLORS.muted}>
              {i === idx ? '❯ ' : '  '}
              {f.label} :
            </Text>
            <Text>{'  '}</Text>
            {i === idx ? (
              <TextInput value={vals[f.key]} onChange={setVal} mask={f.mask ? '•' : undefined} onSubmit={advance} />
            ) : (
              <Text>{f.mask ? '•'.repeat(Math.min(vals[f.key].length, 12)) : vals[f.key] || '—'}</Text>
            )}
          </Box>
        ))}
        <Box marginTop={1}>
          <Hint>tenant / client / secret required. Groups + emails are comma-separated GUIDs / emails (blank ok). Enter advances.</Hint>
        </Box>
      </Box>
    </Screen>
  );
};
