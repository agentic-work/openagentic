import React, { useEffect, useState } from 'react';
import { Text, Box } from 'ink';
import { Beepboop, BB } from './Beepboop.tsx';
import { Grad, ScanRule } from './effects.tsx';

// openagentics.io / Boards-of-Canada palette — warm retro greens, amber, cream.
export const COLORS = {
  accent: '#88CCA0',
  accentDeep: '#5FA877',
  ink: '#E3EBE0',
  muted: '#A9BCA9',
  ok: '#88CCA0',
  warn: '#D9AE52',
  err: '#E0663A',
  led: BB.led,
  teal: BB.tip,
} as const;

// the brand sweep: teal → phosphor → green → amber → burnt-orange
const STOPS = [BB.hi, BB.tip, '#88CCA0', COLORS.warn, BB.led];

// boot-in plays exactly once per process (first step the wizard renders).
let booted = false;

const Badge: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Box marginRight={2}>
    <Text color={COLORS.accentDeep}>▸ </Text>
    <Text color={COLORS.ink}>{children}</Text>
  </Box>
);

const Wordmark: React.FC<{ shown: string; caret?: string }> = ({ shown, caret }) => (
  <Box>
    <Text color={BB.led} bold>
      ⌥{' '}
    </Text>
    <Grad text={shown} stops={STOPS} bold />
    {caret ? (
      <Text color={BB.glow} bold>
        {caret}
      </Text>
    ) : null}
  </Box>
);

export const Banner: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const [f, setF] = useState(0);
  const [phase, setPhase] = useState<'boot' | 'live'>(booted || compact ? 'live' : 'boot');

  useEffect(() => {
    const id = setInterval(() => setF((x) => (x + 1) % 1000), 130);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (phase !== 'boot') return;
    const t = setTimeout(() => {
      booted = true;
      setPhase('live');
    }, 1100);
    return () => clearTimeout(t);
  }, [phase]);

  // slim header for steps 2+ — beepboop's head, the wordmark, a thin trace
  if (compact) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Box>
          <Beepboop compact broadcast />
          <Box marginLeft={2} marginTop={1}>
            <Wordmark shown="openagentic" />
          </Box>
        </Box>
        <ScanRule width={48} frame={f} stops={STOPS} />
      </Box>
    );
  }

  // full hero — panel + boot-in + badges + signal trace
  const word = 'openagentic';
  const shown = phase === 'boot' ? word.slice(0, Math.min(word.length, Math.floor(f * 1.4))) : word;
  const caret = phase === 'boot' && f % 2 === 0 ? '▌' : '';

  return (
    <Box flexDirection="column" paddingY={1}>
      <Box borderStyle="round" borderColor={COLORS.accentDeep} paddingX={2}>
        <Beepboop compact broadcast />
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Wordmark shown={shown} caret={caret} />
          <Text color={COLORS.muted}>the open agentic platform for IT operations</Text>
          <Box marginTop={1}>
            <Badge>self-hosted</Badge>
            <Badge>docker · k8s</Badge>
            <Badge>v1.0</Badge>
          </Box>
          <Box>
            <Text color={BB.tip} italic>
              beep boop
            </Text>
            <Text color={COLORS.muted}> — let&apos;s build something.</Text>
          </Box>
        </Box>
      </Box>
      <Box paddingX={1}>
        <ScanRule width={60} frame={phase === 'boot' ? f * 3 : f} stops={STOPS} />
      </Box>
    </Box>
  );
};

export const StepHeader: React.FC<{ step: number; total: number; title: string }> = ({ step, total, title }) => (
  <Box marginBottom={1}>
    <Text color={COLORS.accentDeep}>◆ </Text>
    <Text color={COLORS.muted}>
      step {step}/{total}
    </Text>
    <Text color={COLORS.muted}> · </Text>
    <Text color={COLORS.ink} bold>
      {title}
    </Text>
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
    <Banner compact={step > 1} />
    <StepHeader step={step} total={total} title={title} />
    {children}
  </Box>
);
