import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { StepHeader, Hint, COLORS } from '../ui/Theme.tsx';
import type { WizardConfig } from '../lib/types.ts';

interface Props {
  initial: WizardConfig['ollama'];
  onDone: (ollama: WizardConfig['ollama']) => void;
}

export const OllamaStep: React.FC<Props> = ({ initial, onDone }) => {
  const [host, setHost] = useState(initial.host);

  return (
    <Box flexDirection="column">
      <StepHeader step={3} total={5} title="Where is your Ollama?" />
      <Box marginLeft={2} flexDirection="column">
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
            Examples: http://localhost:11434, http://host.docker.internal:11434, http://hal:11434
          </Hint>
        </Box>
        <Box>
          <Hint>Ollama is required for embeddings (semantic tool routing). Models are not pulled now.</Hint>
        </Box>
      </Box>
    </Box>
  );
};
