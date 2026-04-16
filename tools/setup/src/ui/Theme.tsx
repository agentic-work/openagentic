import React from 'react';
import { Text, Box } from 'ink';

export const COLORS = {
  accent: '#b784f5',   // purple
  ok: '#34d399',
  warn: '#fbbf24',
  err: '#f87171',
  muted: '#9ca3af',
} as const;

export const Banner: React.FC = () => (
  <Box flexDirection="column" paddingY={1}>
    <Text color={COLORS.accent} bold>
      {'  ╭─────────────────────────────────────────────────╮'}
    </Text>
    <Text color={COLORS.accent} bold>
      {'  │   '}
      <Text color="white">openagentic</Text>
      {'   '}
      <Text color={COLORS.muted}>the agentic platform for IT</Text>
      {'   │'}
    </Text>
    <Text color={COLORS.accent} bold>
      {'  ╰─────────────────────────────────────────────────╯'}
    </Text>
  </Box>
);

export const StepHeader: React.FC<{ step: number; total: number; title: string }> = ({ step, total, title }) => (
  <Box marginY={1}>
    <Text color={COLORS.muted}>
      step {step}/{total}
    </Text>
    <Text color="white" bold>
      {' '}
      {title}
    </Text>
  </Box>
);

export const Hint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text color={COLORS.muted}>{children}</Text>
);
