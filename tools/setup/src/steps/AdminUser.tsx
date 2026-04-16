import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { StepHeader, Hint, COLORS } from '../ui/Theme.tsx';
import type { WizardConfig } from '../lib/types.ts';

interface Props {
  initial: WizardConfig['admin'];
  onDone: (admin: WizardConfig['admin']) => void;
}

export const AdminUserStep: React.FC<Props> = ({ initial, onDone }) => {
  const [email, setEmail] = useState(initial.email);
  const [password, setPassword] = useState(initial.password);
  const [field, setField] = useState<'email' | 'password'>('email');

  return (
    <Box flexDirection="column">
      <StepHeader step={2} total={6} title="Create your admin account" />
      <Box marginLeft={2} flexDirection="column">
        <Box>
          <Text color={field === 'email' ? COLORS.accent : COLORS.muted}>
            {field === 'email' ? '❯ ' : '  '}
            email    :
          </Text>
          <Text>{'  '}</Text>
          {field === 'email' ? (
            <TextInput value={email} onChange={setEmail} onSubmit={() => setField('password')} />
          ) : (
            <Text>{email}</Text>
          )}
        </Box>
        <Box>
          <Text color={field === 'password' ? COLORS.accent : COLORS.muted}>
            {field === 'password' ? '❯ ' : '  '}
            password :
          </Text>
          <Text>{'  '}</Text>
          {field === 'password' ? (
            <TextInput
              value={password}
              onChange={setPassword}
              mask="•"
              onSubmit={() => {
                if (password.length >= 8 && email.includes('@')) {
                  onDone({ ...initial, email, password });
                }
              }}
            />
          ) : (
            <Text>{'•'.repeat(Math.min(password.length, 12))}</Text>
          )}
        </Box>
        <Box marginTop={1}>
          <Hint>Minimum 8 characters. You can change this later from the admin panel.</Hint>
        </Box>
      </Box>
    </Box>
  );
};
