import React, { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import { Screen, Hint, COLORS } from '../ui/Theme.tsx';
import { findKubeconfig, probeCluster, validateKubeconfigPath, type K8sProbe } from '../lib/k8s.ts';

type Phase =
  | { stage: 'picking-kubeconfig'; input: string; error: string | null }
  | { stage: 'probing'; kubeconfigPath: string }
  | { stage: 'ready'; probe: K8sProbe };

interface Props {
  onContinue: (kubeconfigPath: string) => void;
  onBackToDocker: () => void;
}

export const HelmPreflightStep: React.FC<Props> = ({ onContinue, onBackToDocker }) => {
  const initialPath = findKubeconfig();
  const [phase, setPhase] = useState<Phase>(
    initialPath
      ? { stage: 'probing', kubeconfigPath: initialPath }
      : { stage: 'picking-kubeconfig', input: '', error: null }
  );

  useEffect(() => {
    if (phase.stage !== 'probing') return;
    let cancelled = false;
    probeCluster(phase.kubeconfigPath).then((probe) => {
      if (!cancelled) setPhase({ stage: 'ready', probe });
    });
    return () => { cancelled = true; };
  }, [phase.stage === 'probing' ? phase.kubeconfigPath : null]);

  useInput((_input, key) => {
    if (phase.stage === 'picking-kubeconfig' && key.escape) onBackToDocker();
  });

  if (phase.stage === 'picking-kubeconfig') {
    return (
      <Screen step={2} total={10} title="Checking your cluster">
        <Box flexDirection="column" marginBottom={1}>
          <Text>No kubeconfig found at <Text color={COLORS.accent}>$KUBECONFIG</Text> or <Text color={COLORS.accent}>~/.kube/config</Text>.</Text>
          <Text>Paste a path to your kubeconfig, or press <Text color={COLORS.accent}>Esc</Text> to go back to Docker.</Text>
        </Box>
        <Box>
          <Text>kubeconfig: </Text>
          <TextInput
            value={phase.input}
            onChange={(v) => setPhase({ ...phase, input: v, error: null })}
            onSubmit={(v) => {
              const res = validateKubeconfigPath(v);
              if (!res.ok) {
                setPhase({ ...phase, error: res.reason });
                return;
              }
              setPhase({ stage: 'probing', kubeconfigPath: res.path });
            }}
          />
        </Box>
        {phase.error && (
          <Box marginTop={1}><Text color={COLORS.err}>{phase.error}</Text></Box>
        )}
      </Screen>
    );
  }

  if (phase.stage === 'probing') {
    return (
      <Screen step={2} total={10} title="Checking your cluster">
        <Box>
          <Text color={COLORS.accent}><Spinner type="dots" /></Text>
          <Text> probing cluster via {phase.kubeconfigPath}…</Text>
        </Box>
      </Screen>
    );
  }

  // stage === 'ready'
  const { probe } = phase;
  const rows: Array<{ label: string; value: string; colour?: string }> = [
    { label: 'kubeconfig', value: probe.kubeconfigPath },
    {
      label: 'kubectl',
      value: probe.kubectlVersion ?? 'not found on PATH',
      colour: probe.kubectlVersion ? undefined : COLORS.err,
    },
    {
      label: 'helm',
      value: probe.helmVersion ?? 'not found on PATH',
      colour: probe.helmVersion ? undefined : COLORS.err,
    },
    {
      label: 'context',
      value: probe.context ?? 'no current context set',
      colour: probe.context ? undefined : COLORS.err,
    },
    {
      label: 'cluster',
      value: probe.reachable
        ? `${probe.serverVersion ?? 'unknown'} (${probe.nodeCount ?? '?'} nodes)`
        : 'unreachable',
      colour: probe.reachable ? undefined : COLORS.err,
    },
    {
      label: 'namespace',
      value: probe.namespaceExists ? 'openagentic — exists' : 'openagentic — does not exist',
      colour: probe.namespaceExists ? COLORS.warn : undefined,
    },
    {
      label: 'existing release',
      value: probe.existingRelease
        ? `${probe.existingRelease.name} rev ${probe.existingRelease.revision} (${probe.existingRelease.status})`
        : 'none',
      colour: probe.existingRelease ? COLORS.warn : undefined,
    },
  ];

  const hardFailReason =
    !probe.kubectlVersion ? 'kubectl is not installed or not on PATH.'
    : !probe.helmVersion ? 'helm is not installed or not on PATH.'
    : !probe.context ? 'no current kubectl context is set. Run: kubectl config use-context <name>'
    : !probe.reachable ? 'cluster is unreachable. Check VPN / kubeconfig / network.'
    : null;

  if (hardFailReason) {
    return (
      <Screen step={2} total={10} title="Checking your cluster">
        <Box flexDirection="column">
          {rows.map((r) => (
            <Box key={r.label}>
              <Box width={18}><Text color={COLORS.muted}>{r.label}</Text></Box>
              <Text color={r.colour}>{r.value}</Text>
            </Box>
          ))}
        </Box>
        <Box marginTop={1}><Text color={COLORS.err}>{hardFailReason}</Text></Box>
        <Box marginTop={1}>
          <SelectInput
            items={[
              { label: 'Back to Docker deploy', value: 'docker' as const },
              { label: 'Quit', value: 'quit' as const },
            ]}
            onSelect={(item) => {
              if (item.value === 'docker') onBackToDocker();
              else process.exit(0);
            }}
          />
        </Box>
      </Screen>
    );
  }

  // Soft warnings (existing release or adopted namespace)
  const warning =
    probe.existingRelease
      ? `Existing release 'openagentic' (rev ${probe.existingRelease.revision}). Continuing will run helm upgrade.`
      : probe.namespaceExists
      ? `Namespace 'openagentic' exists but no Helm release. Continuing will adopt it.`
      : null;

  return (
    <Screen step={2} total={10} title="Checking your cluster">
      <Box flexDirection="column">
        {rows.map((r) => (
          <Box key={r.label}>
            <Box width={18}><Text color={COLORS.muted}>{r.label}</Text></Box>
            <Text color={r.colour}>{r.value}</Text>
          </Box>
        ))}
      </Box>
      {warning && (
        <Box marginTop={1}><Text color={COLORS.warn}>⚠ {warning}</Text></Box>
      )}
      <Box marginTop={1}>
        <SelectInput
          items={[
            { label: probe.existingRelease ? 'Upgrade existing release' : 'Continue', value: 'continue' as const },
            { label: 'Back to Docker deploy', value: 'docker' as const },
          ]}
          onSelect={(item) => {
            if (item.value === 'continue') onContinue(probe.kubeconfigPath);
            else onBackToDocker();
          }}
        />
      </Box>
      <Box marginTop={1}>
        <Hint>Helm backend implementation is still in progress — the preflight above will run, but the final install step may not complete. See CLAUDE.md.</Hint>
      </Box>
    </Screen>
  );
};
