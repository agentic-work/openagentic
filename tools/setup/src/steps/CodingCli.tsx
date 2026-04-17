import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { Screen, Hint, COLORS } from '../ui/Theme.tsx';
import type { CodingAdapterId } from '../lib/types.ts';

interface Props {
  initial: CodingAdapterId;
  step: number;
  total: number;
  onPick: (id: CodingAdapterId) => void;
}

export const CodingCliStep: React.FC<Props> = ({ initial, step, total, onPick }) => {
  const items = [
    { label: 'Claude Code   (Anthropic — bundled)',     value: 'claude-code' as const },
    { label: 'Gemini CLI    (Google — bundled)',        value: 'gemini-cli' as const },
    { label: 'None          (bare terminal)',           value: 'none' as const },
  ];
  const initialIndex = Math.max(0, items.findIndex((i) => i.value === initial));

  return (
    <Screen step={step} total={total} title="Which coding CLI should Code Mode use?">
      <SelectInput
        items={items}
        initialIndex={initialIndex}
        onSelect={(i) => onPick(i.value)}
        indicatorComponent={({ isSelected }) => (
          <Text color={COLORS.accent}>{isSelected ? '❯ ' : '  '}</Text>
        )}
      />
      <Box marginTop={1} flexDirection="column">
        <Hint>Both Claude Code and Gemini CLI are pre-installed in the sandbox.</Hint>
        <Hint>Aider / OpenCode / Open Interpreter / Cursor can be installed later from the terminal.</Hint>
        <Hint>The API key for whichever you pick comes from the LLM provider step.</Hint>
      </Box>
    </Screen>
  );
};
