import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { Banner, StepHeader, Hint, COLORS } from '../ui/Theme.tsx';
import type { DeployTarget } from '../lib/types.ts';

interface Props {
  onPick: (t: DeployTarget) => void;
}

export const DeployTargetStep: React.FC<Props> = ({ onPick }) => {
  const items = [
    { label: 'Docker   (local / single machine)', value: 'docker' as const },
    { label: 'Helm     (production / kubernetes)', value: 'helm' as const },
  ];
  return (
    <Box flexDirection="column">
      <Banner />
      <StepHeader step={1} total={5} title="Where do you want to run openagentic?" />
      <Box marginLeft={2}>
        <SelectInput items={items} onSelect={(i) => onPick(i.value)} indicatorComponent={Indicator} />
      </Box>
      <Box marginTop={1} marginLeft={2}>
        <Hint>Both paths land at http://localhost:8080 with the same UI.</Hint>
      </Box>
    </Box>
  );
};

const Indicator: React.FC<{ isSelected?: boolean }> = ({ isSelected }) => (
  <Text color={COLORS.accent}>{isSelected ? '❯ ' : '  '}</Text>
);
