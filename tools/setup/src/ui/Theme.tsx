import React from 'react';
import { Text, Box } from 'ink';
import { Beepboop, BB } from './Beepboop.tsx';

// openagentics.io / Boards-of-Canada palette — warm retro greens, amber, cream.
// (was the old Claude-ish purple; re-keyed so every step matches the brand.)
export const COLORS = {
  accent: '#88CCA0',   // dusty green accent text (--accent-ink)
  accentDeep: '#5FA877', // deep faded teal-green (--accent / --signal)
  ink: '#E3EBE0',      // aged warm cream (primary text)
  muted: '#A9BCA9',    // secondary cream
  ok: '#88CCA0',       // green
  warn: '#D9AE52',     // amber
  err: '#E0663A',      // hot burnt-orange
  teal: BB.tip,        // beepboop phosphor teal
} as const;

export const Banner: React.FC = () => (
  <Box paddingY={1}>
    <Box borderStyle="round" borderColor={COLORS.accentDeep} paddingX={2}>
      {/* beepboop says hi from the masthead */}
      <Beepboop compact />
      <Box flexDirection="column" marginLeft={2} marginTop={1}>
        <Text>
          <Text color={COLORS.accent} bold>
            ⌥ openagentic
          </Text>
        </Text>
        <Text color={COLORS.muted}>the open agentic platform for IT operations</Text>
        <Box marginTop={1}>
          <Text color={BB.tip} italic>
            beep boop
          </Text>
          <Text color={COLORS.muted}> — let&apos;s get you set up.</Text>
        </Box>
      </Box>
    </Box>
  </Box>
);

export const StepHeader: React.FC<{ step: number; total: number; title: string }> = ({ step, total, title }) => (
  <Box marginBottom={1}>
    <Text color={COLORS.muted}>step {step}/{total}</Text>
    <Text color={COLORS.muted}> · </Text>
    <Text color={COLORS.ink} bold>{title}</Text>
  </Box>
);

export const Hint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text color={COLORS.muted}>{children}</Text>
);

// Screen wrapper — consistent 2-col left padding + top banner + step header for every wizard step.
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
