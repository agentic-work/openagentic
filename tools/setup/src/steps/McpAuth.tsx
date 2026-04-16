import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StepHeader, Hint, COLORS } from '../ui/Theme.tsx';
import { mcpsThatNeedAuth, type McpDefinition } from '../lib/mcps.ts';

interface Props {
  enabledIds: string[];
  initialAuth: Record<string, string>;
  onDone: (auth: Record<string, string>) => void;
}

type Phase = 'choose-source' | 'fields' | 'done';

const CLOUD_SECRETS_DIR = path.join(os.homedir(), '.openagentic', 'cloud-secrets');

/**
 * Collects auth for each enabled MCP that requires credentials. Walks
 * the list one MCP at a time; each has either an env-file source picker
 * or a set of inline fields.
 */
export const McpAuthStep: React.FC<Props> = ({ enabledIds, initialAuth, onDone }) => {
  const needAuth = mcpsThatNeedAuth(enabledIds);
  const [idx, setIdx] = useState(0);
  const [auth, setAuth] = useState<Record<string, string>>({ ...initialAuth });

  // If nothing needs auth, skip straight through.
  if (needAuth.length === 0) {
    onDone(auth);
    return null;
  }

  const current = needAuth[idx];
  const finishCurrent = (partial: Record<string, string>) => {
    const merged = { ...auth, ...partial };
    setAuth(merged);
    if (idx + 1 < needAuth.length) setIdx(idx + 1);
    else onDone(merged);
  };

  return (
    <Box flexDirection="column">
      <StepHeader
        step={5}
        total={7}
        title={`${current.label}: credentials (${idx + 1} of ${needAuth.length})`}
      />
      <Box marginLeft={2}>
        {/* Key forces a fresh mount per MCP so fieldIdx/phase/values reset cleanly. */}
        <McpAuthPrompt key={current.id} mcp={current} auth={auth} onDone={finishCurrent} />
      </Box>
    </Box>
  );
};

interface PromptProps {
  mcp: McpDefinition;
  auth: Record<string, string>;
  onDone: (partial: Record<string, string>) => void;
}

const McpAuthPrompt: React.FC<PromptProps> = ({ mcp, auth, onDone }) => {
  const envFilePath = mcp.envFile ? path.join(CLOUD_SECRETS_DIR, mcp.envFile) : undefined;
  const envFileExists = !!envFilePath && fs.existsSync(envFilePath);
  const [phase, setPhase] = useState<Phase>(
    mcp.authType === 'env-file' ? 'choose-source' : 'fields'
  );
  const [fieldIdx, setFieldIdx] = useState(0);
  const [values, setValues] = useState<Record<string, string>>(
    mcp.envVars ? Object.fromEntries(mcp.envVars.map((f) => [f.env, auth[f.env] ?? ''])) : {}
  );

  // Env-file source picker
  if (phase === 'choose-source' && mcp.authType === 'env-file') {
    const items = [
      ...(envFileExists
        ? [{ label: `Use ${envFilePath} (detected — recommended)`, value: 'use-file' as const }]
        : [{ label: `Create empty ${envFilePath} stub (fill in later)`, value: 'stub' as const }]),
      { label: 'Paste credentials inline now', value: 'paste' as const },
      { label: 'Skip (this MCP will stay disabled)', value: 'skip' as const },
    ];
    return (
      <Box flexDirection="column">
        <Text color={COLORS.muted}>{mcp.blurb}</Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(i) => {
              if (i.value === 'use-file' || i.value === 'stub') {
                onDone({});  // source lives on-disk; nothing to merge into .env
              } else if (i.value === 'skip') {
                onDone({ [`__skip_${mcp.id}`]: '1' });  // marker, Launch will strip from enabled
              } else {
                setPhase('fields');
              }
            }}
            indicatorComponent={({ isSelected }) => (
              <Text color={COLORS.accent}>{isSelected ? '❯ ' : '  '}</Text>
            )}
          />
        </Box>
      </Box>
    );
  }

  // Inline field entry
  const field = mcp.envVars?.[fieldIdx];
  if (!field) {
    onDone(values);
    return null;
  }
  return (
    <Box flexDirection="column">
      <Text color={COLORS.muted}>{mcp.blurb}</Text>
      {mcp.envVars!.map((f, i) => (
        <Box key={f.env}>
          <Text color={i === fieldIdx ? COLORS.accent : COLORS.muted}>
            {i === fieldIdx ? '❯ ' : '  '}
            {f.label.padEnd(32)}
          </Text>
          <Text>: </Text>
          {i === fieldIdx ? (
            <TextInput
              value={values[f.env] ?? ''}
              onChange={(v) => setValues({ ...values, [f.env]: v })}
              mask={f.mask ? '•' : undefined}
              onSubmit={() => {
                if (fieldIdx + 1 < mcp.envVars!.length) setFieldIdx(fieldIdx + 1);
                else onDone(values);
              }}
            />
          ) : (
            <Text>{f.mask && values[f.env] ? '•'.repeat(Math.min(values[f.env].length, 16)) : values[f.env] || ''}</Text>
          )}
        </Box>
      ))}
      <Box marginTop={1}>
        <Hint>Enter to advance · leave blank to skip an optional field</Hint>
      </Box>
    </Box>
  );
};
