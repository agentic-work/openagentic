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
  <Box paddingY={1}>
    <Box borderStyle="round" borderColor={COLORS.accent} paddingX={2}>
      <Text color="white" bold>openagentic</Text>
      <Text>{'   '}</Text>
      <Text color={COLORS.muted}>the agentic platform for IT</Text>
    </Box>
  </Box>
);

export const StepHeader: React.FC<{ step: number; total: number; title: string }> = ({ step, total, title }) => (
  <Box marginBottom={1}>
    <Text color={COLORS.muted}>step {step}/{total}</Text>
    <Text color={COLORS.muted}> · </Text>
    <Text color="white" bold>{title}</Text>
  </Box>
);

export const Hint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text color={COLORS.muted}>{children}</Text>
);

// Screen wrapper — consistent 2-col left padding + top banner + step header for every wizard step.
// Eliminates per-step margin drift.
interface ScreenProps {
  step: number;
  total: number;
  title: string;
  children: React.ReactNode;
}

export const Screen: React.FC<ScreenProps> = ({ step, total, title, children }) => (
  <Box flexDirection="column" paddingX={2}>
    <Banner />
    <StepHeader step={step} total={total} title={title} />
    {children}
  </Box>
);
