import React from 'react';
import { Text, Box } from 'ink';
import { COLORS } from './Theme.tsx';
import { Rule } from './effects.tsx';
import { Link } from './Link.tsx';
import { getDocFor } from '../lib/docs.ts';

const STOPS = ['#2C3A31', '#3A4A3E', '#2C3A31'];
const width = () => Math.max(44, Math.min((process.stdout.columns || 80) - 6, 88));

// A dim key shown as: <key in ink> <gloss in faint>
const Key: React.FC<{ k: string; gloss: string; last?: boolean }> = ({ k, gloss, last }) => (
  <Text>
    <Text color={COLORS.muted}>{k}</Text>
    <Text color={COLORS.faint}> {gloss}</Text>
    {last ? null : <Text color={COLORS.faint}>{'  ·  '}</Text>}
  </Text>
);

/** A persistent, dim footer: a hairline rule, a row of context keys, and the
 *  current step's doc as an OSC-8 hyperlink. */
export const Footer: React.FC<{ title: string }> = ({ title }) => {
  const doc = getDocFor(title);
  return (
    <Box flexDirection="column" marginTop={1}>
      <Rule width={width()} stops={STOPS} />
      <Box>
        <Key k="↑↓" gloss="move" />
        <Key k="↵" gloss="select" />
        <Key k="?" gloss="help" />
        <Key k="d" gloss="docs" />
        <Key k="esc" gloss="back" />
        <Key k="^C" gloss="quit" last />
      </Box>
      <Box marginTop={0}>
        <Text color={COLORS.faint}>📖 </Text>
        <Link url={doc.url} text={`${doc.label} →`} />
      </Box>
    </Box>
  );
};

export default Footer;
