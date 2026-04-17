import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { Screen, Hint, COLORS } from '../ui/Theme.tsx';
import { MCPS } from '../lib/mcps.ts';

interface Props {
  initial: string[];
  step: number;
  total: number;
  onDone: (selected: string[]) => void;
}

/**
 * Multi-select MCP picker. Space toggles; Enter commits.
 */
export const McpSelectionStep: React.FC<Props> = ({ initial, step, total, onDone }) => {
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (key.upArrow)   { setCursor((c) => Math.max(0, c - 1)); return; }
    if (key.downArrow) { setCursor((c) => Math.min(MCPS.length - 1, c + 1)); return; }
    if (input === ' ') {
      const id = MCPS[cursor].id;
      const next = new Set(selected);
      next.has(id) ? next.delete(id) : next.add(id);
      setSelected(next);
      return;
    }
    if (key.return) {
      onDone(Array.from(selected));
      return;
    }
    if (input === 'a') {   // select all
      setSelected(new Set(MCPS.map((m) => m.id)));
      return;
    }
    if (input === 'n') {   // select none
      setSelected(new Set());
      return;
    }
  });

  return (
    <Screen step={step} total={total} title="Which MCPs do you want enabled?">
      <Box flexDirection="column">
        {MCPS.map((m, i) => {
          const on = selected.has(m.id);
          const isCursor = i === cursor;
          const box = on ? '[x]' : '[ ]';
          const labelCol = isCursor ? COLORS.accent : 'white';
          const blurbCol = COLORS.muted;
          return (
            <Box key={m.id}>
              <Text color={isCursor ? COLORS.accent : COLORS.muted}>{isCursor ? '❯ ' : '  '}</Text>
              <Text color={on ? COLORS.ok : COLORS.muted}>{box}</Text>
              <Box width={20}>
                <Text color={labelCol}>  {m.label}</Text>
              </Box>
              <Text color={blurbCol}>  {m.blurb}</Text>
            </Box>
          );
        })}
        <Box marginTop={1}>
          <Hint>Space toggles  ·  a = all  ·  n = none  ·  Enter to continue</Hint>
        </Box>
      </Box>
    </Screen>
  );
};
