import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { Screen, Hint, COLORS } from '../ui/Theme.tsx';
import type { WizardConfig } from '../lib/types.ts';

interface Props {
  initial: WizardConfig['ollama'];
  step: number;
  total: number;
  onDone: (ollama: WizardConfig['ollama']) => void;
}

export const OllamaStep: React.FC<Props> = ({ initial, step, total, onDone }) => {
  const [host, setHost] = useState(initial.host);

  return (
    <Screen step={step} total={total} title="Where is your Ollama?">
      <Box flexDirection="column">
        <Box>
          <Text color={COLORS.accent}>❯ </Text>
          <Text>host: </Text>
          <TextInput
            value={host}
            onChange={setHost}
            onSubmit={() => onDone({ ...initial, host })}
          />
        </Box>
        <Box marginTop={1}>
          <Hint>
            http://ollama:11434 = the bundled container (started by the `ollama`
            compose profile). Use http://host.docker.internal:11434 to reach an
            Ollama you already run on your host instead.
          </Hint>
        </Box>
        <Box>
          <Hint>You chose Ollama, so the platform will start it and pre-pull the embed model on first boot. No other provider is touched.</Hint>
        </Box>
      </Box>
    </Screen>
  );
};
