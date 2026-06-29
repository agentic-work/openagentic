import React from 'react';
import { Text } from 'ink';
import SelectInput from 'ink-select-input';
import { Screen, Hint, COLORS } from '../ui/Theme.tsx';
import type { DeployTarget } from '../lib/types.ts';

interface Props {
  /** target = docker|helm; headless = docker without the UI container (API-only). */
  onPick: (t: DeployTarget, headless: boolean) => void;
}

export const DeployTargetStep: React.FC<Props> = ({ onPick }) => {
  const items = [
    { label: 'Docker   (local / single machine, with web UI)', value: 'docker-full' as const },
    { label: 'Docker   (headless — API only, drive with the `oa` CLI)', value: 'docker-headless' as const },
    { label: 'Helm     (production / kubernetes)', value: 'helm' as const },
  ];
  return (
    <Screen step={1} total={9} title="Where do you want to run openagentic?">
      <SelectInput
        items={items}
        onSelect={(i) => {
          if (i.value === 'helm') onPick('helm', false);
          else onPick('docker', i.value === 'docker-headless');
        }}
        indicatorComponent={Indicator}
      />
      <Hint>Headless skips the UI container entirely — the API is published on the host and you control everything with `oa`.</Hint>
    </Screen>
  );
};

const Indicator: React.FC<{ isSelected?: boolean }> = ({ isSelected }) => (
  <Text color={COLORS.accent}>{isSelected ? '❯ ' : '  '}</Text>
);
