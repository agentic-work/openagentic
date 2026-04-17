import React from 'react';
import { Text } from 'ink';
import SelectInput from 'ink-select-input';
import { Screen, Hint, COLORS } from '../ui/Theme.tsx';
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
    <Screen step={1} total={9} title="Where do you want to run openagentic?">
      <SelectInput items={items} onSelect={(i) => onPick(i.value)} indicatorComponent={Indicator} />
      <Hint>Both paths land at http://localhost:8080 with the same UI.</Hint>
    </Screen>
  );
};

const Indicator: React.FC<{ isSelected?: boolean }> = ({ isSelected }) => (
  <Text color={COLORS.accent}>{isSelected ? '❯ ' : '  '}</Text>
);
