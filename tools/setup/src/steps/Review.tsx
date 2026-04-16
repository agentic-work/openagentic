import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { StepHeader, Hint, COLORS } from '../ui/Theme.tsx';
import type { WizardConfig } from '../lib/types.ts';

interface Props {
  config: WizardConfig;
  onLaunch: () => void;
  onCancel: () => void;
}

export const ReviewStep: React.FC<Props> = ({ config, onLaunch, onCancel }) => {
  const providerCount = Object.values(config.providers).filter(Boolean).length;

  const row = (label: string, value: string) => (
    <Box key={label}>
      <Box width={18}>
        <Text color={COLORS.muted}>{label}</Text>
      </Box>
      <Text>{value}</Text>
    </Box>
  );

  return (
    <Box flexDirection="column">
      <StepHeader step={6} total={6} title="Review & launch" />
      <Box marginLeft={2} flexDirection="column">
        {row('deploy target', config.target)}
        {row('admin email', config.admin.email)}
        {row('ollama host', config.ollama.host)}
        {row('embedding model', config.ollama.embedModel)}
        {row('LLM providers', providerCount > 0 ? `${providerCount} configured` : 'Ollama only')}
        {row('coding CLI', config.codingAdapter)}
        {row('UI port', String(config.uiPort))}
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
