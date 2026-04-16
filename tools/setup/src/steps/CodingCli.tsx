import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { StepHeader, Hint, COLORS } from '../ui/Theme.tsx';
import type { CodingAdapterId } from '../lib/types.ts';

interface Props {
  initial: CodingAdapterId;
  onPick: (id: CodingAdapterId) => void;
}

export const CodingCliStep: React.FC<Props> = ({ initial, onPick }) => {
  const items = [
    { label: 'Claude Code   (Anthropic — bundled)',     value: 'claude-code' as const },
    { label: 'Gemini CLI    (Google — bundled)',        value: 'gemini-cli' as const },
    { label: 'None          (bare terminal)',           value: 'none' as const },
  ];
  const initialIndex = Math.max(0, items.findIndex((i) => i.value === initial));

  return (
    <Box flexDirection="column">
      <StepHeader step={5} total={6} title="Which coding CLI should Code Mode use?" />
      <Box marginLeft={2}>
        <SelectInput
          items={items}
          initialIndex={initialIndex}
          onSelect={(i) => onPick(i.value)}
          indicatorComponent={({ isSelected }) => (
            <Text color={COLORS.accent}>{isSelected ? '❯ ' : '  '}</Text>
          )}
        />
      </Box>
      <Box marginTop={1} marginLeft={2} flexDirection="column">
        <Hint>Both Claude Code and Gemini CLI are pre-installed in the sandbox.</Hint>
        <Hint>Aider / OpenCode / Open Interpreter / Cursor can be installed later from the terminal.</Hint>
        <Hint>The API key for whichever you pick comes from the LLM provider step.</Hint>
      </Box>
    </Box>
  );
};
