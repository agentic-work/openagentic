import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Screen, Hint, COLORS } from '../ui/Theme.tsx';
import { mcpsThatNeedAuth, type McpDefinition } from '../lib/mcps.ts';

interface Props {
  enabledIds: string[];
  initialAuth: Record<string, string>;
  step: number;
  total: number;
  onDone: (auth: Record<string, string>) => void;
}

type Phase = 'choose-source' | 'fields' | 'done';

const CLOUD_SECRETS_DIR = path.join(os.homedir(), '.openagentic', 'cloud-secrets');

/**
 * Collects auth for each enabled MCP that requires credentials. Walks
 * the list one MCP at a time; each has either an env-file source picker
 * or a set of inline fields.
 */
export const McpAuthStep: React.FC<Props> = ({ enabledIds, initialAuth, step, total, onDone }) => {
  // mcpsThatNeedAuth already excludes MCPs whose backend ships in-stack
  // (bundledBackend = prometheus / loki) — they're auto-wired by Launch.toEnv()
  // and must never prompt for a server URL or credentials. Filter again here so
  // the skip is explicit at this step regardless of how the list is derived.
  const needAuth = mcpsThatNeedAuth(enabledIds).filter((m) => !m.bundledBackend);
  const [idx, setIdx] = useState(0);
  const [auth, setAuth] = useState<Record<string, string>>({ ...initialAuth });

  // If nothing needs auth, skip straight through. Defer onDone to an effect —
  // calling a parent setState during render warns (and is a real React bug).
  const skip = needAuth.length === 0;
  useEffect(() => { if (skip) onDone(auth); }, [skip]);
  if (skip) return null;

  const current = needAuth[idx];
  const finishCurrent = (partial: Record<string, string>) => {
    const merged = { ...auth, ...partial };
    setAuth(merged);
    if (idx + 1 < needAuth.length) setIdx(idx + 1);
    else onDone(merged);
  };

  return (
    <Screen
      step={step}
      total={total}
      title={`${current.label}: credentials (${idx + 1} of ${needAuth.length})`}
    >
      {/* Key forces a fresh mount per MCP so fieldIdx/phase/values reset cleanly. */}
      <McpAuthPrompt key={current.id} mcp={current} auth={auth} onDone={finishCurrent} />
    </Screen>
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
  // 'fields' MCPs that have detectable host-creds also get the chooser
  // (otherwise users get dropped straight into a text input for a path
  // we could have detected for them).
  const fieldsHasHostCreds = mcp.authType === 'fields' && (mcp.hostCreds?.detect() ?? false);
  const [phase, setPhase] = useState<Phase>(
    mcp.authType === 'env-file' || fieldsHasHostCreds ? 'choose-source' : 'fields'
  );
  const [fieldIdx, setFieldIdx] = useState(0);
  const [values, setValues] = useState<Record<string, string>>(
    mcp.envVars ? Object.fromEntries(mcp.envVars.map((f) => [f.env, auth[f.env] ?? ''])) : {}
  );

  // Auto-advance when there are no (more) fields to collect — deferred to an
  // effect so we don't setState the parent during render.
  const field = mcp.envVars?.[fieldIdx];
  const fieldsComplete = phase === 'fields' && !field;
  useEffect(() => { if (fieldsComplete) onDone(values); }, [fieldsComplete]);

  // Env-file source picker.
  // For MCPs that can use the user's mounted host CLI creds (~/.aws, ~/.azure,
  // ~/.config/gcloud), surface that as the first option whenever detected —
  // it's the zero-paste path and the one we steer users toward for the
  // "5 minutes to 'show me my Azure subs'" flow.
  if (phase === 'choose-source') {
    const hostCredsAvailable = mcp.hostCreds?.detect() ?? false;
    const items = [
      ...(hostCredsAvailable
        ? [{ label: `${mcp.hostCreds!.description} (detected — recommended)`, value: 'host-creds' as const }]
        : []),
      ...(mcp.authType === 'env-file'
        ? (envFileExists
            ? [{ label: `Use ${envFilePath} (detected)`, value: 'use-file' as const }]
            : [{ label: `Create empty ${envFilePath} stub (fill in later)`, value: 'stub' as const }])
        : []),
      { label: mcp.authType === 'env-file' ? 'Paste credentials inline now' : 'Enter credentials inline', value: 'paste' as const },
      { label: 'Skip (this MCP will stay disabled)', value: 'skip' as const },
    ];
    return (
      <Box flexDirection="column">
        <Text color={COLORS.muted}>{mcp.blurb}</Text>
        <Box marginTop={1}>
          <SelectInput
            items={items}
            onSelect={(i) => {
              if (i.value === 'host-creds' || i.value === 'use-file' || i.value === 'stub') {
                onDone({});  // source lives on-disk / on mounted host volume; nothing to merge
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
  if (!field) return null;
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
