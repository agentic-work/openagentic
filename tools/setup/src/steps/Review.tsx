import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { StepHeader, Hint, COLORS } from '../ui/Theme.tsx';
import type { WizardConfig } from '../lib/types.ts';
import { mcpsThatNeedAuth } from '../lib/mcps.ts';

interface Props {
  config: WizardConfig;
  onLaunch: () => void;
  onCancel: () => void;
}

export const ReviewStep: React.FC<Props> = ({ config, onLaunch, onCancel }) => {
  const providerCount = Object.values(config.providers).filter(Boolean).length;

  // Summarize MCPs: enabled count + which ones still need creds filled in.
  const needAuth = mcpsThatNeedAuth(config.mcps);
  const missingCreds = needAuth.filter((m) => {
    // field-type MCPs are "missing" if the user didn't supply any of the envVars
    if (m.authType === 'fields' && m.envVars) {
      return !m.envVars.some((f) => config.mcpAuth[f.env]);
    }
    // env-file MCPs rely on files on disk, which we can't inspect from here;
    // treat as "not blocked" and let the proxy log if the file is missing.
    return false;
  });
  const mcpSummary =
    config.mcps.length === 0
      ? 'none selected'
      : `${config.mcps.length} enabled (${config.mcps.slice(0, 4).join(', ')}${config.mcps.length > 4 ? '…' : ''})`;

  const row = (label: string, value: string, color?: string) => (
    <Box key={label}>
      <Box width={18}>
        <Text color={COLORS.muted}>{label}</Text>
      </Box>
      <Text color={color}>{value}</Text>
    </Box>
  );

  return (
    <Box flexDirection="column">
      <StepHeader step={7} total={7} title="Review & launch" />
      <Box marginLeft={2} flexDirection="column">
        {row('deploy target', config.target)}
        {row('admin email', config.admin.email)}
        {row('ollama host', config.ollama.host)}
        {row('embedding model', config.ollama.embedModel)}
        {row('LLM providers', providerCount > 0 ? `${providerCount} configured` : 'Ollama only')}
        {row('coding CLI', config.codingAdapter)}
        {row('MCPs', mcpSummary)}
        {row('UI port', String(config.uiPort))}
        {missingCreds.length > 0 && (
          <Box marginTop={1}>
            <Text color={COLORS.err}>⚠ missing creds: {missingCreds.map((m) => m.label).join(', ')}</Text>
          </Box>
        )}
      </Box>
      <Box marginTop={1} marginLeft={2}>
        <SelectInput
          items={[
            { label: `Launch ${config.target}`, value: 'go' as const },
            { label: 'Cancel', value: 'no' as const },
          ]}
          onSelect={(i) => (i.value === 'go' ? onLaunch() : onCancel())}
          indicatorComponent={({ isSelected }) => <Text color={COLORS.accent}>{isSelected ? '❯ ' : '  '}</Text>}
        />
      </Box>
      <Box marginTop={1} marginLeft={2}>
        <Hint>Nothing has been written to disk yet. Launch will write .env and bring the stack up.</Hint>
      </Box>
    </Box>
  );
};
