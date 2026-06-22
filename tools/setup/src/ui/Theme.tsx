import React from 'react';
import { Text, Box } from 'ink';
import { Grad, Rule, Bar } from './effects.tsx';

// openagentics.io / Boards-of-Canada palette — warm retro greens, amber, cream.
export const COLORS = {
  accent: '#88CCA0',
  accentDeep: '#5FA877',
  ink: '#E3EBE0',
  muted: '#8C9C8C',
  faint: '#5E6E5E',
  ok: '#88CCA0',
  warn: '#D9AE52',
  err: '#E0663A',
  signal: '#DB8240',
  teal: '#9FD8C4',
} as const;

// the brand sweep: teal → phosphor → green → amber → burnt-orange
const STOPS = ['#6FB3A8', '#9FD8C4', '#88CCA0', '#D9AE52', '#DB8240'];

const width = () => Math.max(44, Math.min((process.stdout.columns || 80) - 6, 88));

export const Banner: React.FC = () => {
  const w = width();
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box width={w} justifyContent="space-between">
        <Box>
          <Text color={COLORS.signal} bold>
            ⌥{'  '}
          </Text>
          <Grad text="openagentic" stops={STOPS} bold />
        </Box>
        <Text color={COLORS.faint}>self-hosted · docker / k8s · v1.0</Text>
      </Box>
      <Rule width={w} stops={STOPS} />
      <Text color={COLORS.muted}>the open agentic platform for IT operations</Text>
    </Box>
  );
};

export const StepHeader: React.FC<{ step: number; total: number; title: string }> = ({ step, total, title }) => (
  <Box flexDirection="column" marginBottom={1}>
    <Box>
      <Text color={COLORS.accent} bold>
        {String(step).padStart(2, '0')}
      </Text>
      <Text color={COLORS.faint}> / {String(total).padStart(2, '0')}</Text>
      <Text color={COLORS.faint}>{'   '}</Text>
      <Text color={COLORS.ink} bold>
        {title}
      </Text>
    </Box>
    <Box marginTop={0}>
      <Bar value={step} total={total} width={Math.min(36, width())} stops={STOPS} />
    </Box>
  </Box>
);

export const Hint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text color={COLORS.muted}>{children}</Text>
);

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
