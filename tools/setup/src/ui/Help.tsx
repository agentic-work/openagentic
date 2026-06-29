import React from 'react';
import { Text, Box } from 'ink';
import { COLORS } from './Theme.tsx';
import { Link } from './Link.tsx';
import { getDocFor } from '../lib/docs.ts';

interface Binding {
  key: string;
  gloss: string;
}

const BINDINGS: Binding[] = [
  { key: '↑ ↓', gloss: 'move the highlight between choices' },
  { key: '↵', gloss: 'select the highlighted choice / submit a field' },
  { key: 'space', gloss: 'toggle an item in a multi-select list' },
  { key: '?', gloss: 'open or close this help overlay' },
  { key: 'd', gloss: 'open this step’s docs in your browser' },
  { key: 'esc', gloss: 'go back / close this overlay' },
  { key: '^C', gloss: 'quit the setup wizard' },
];

// A one-line "what this step does", keyed off recognisable words in the title so
// it stays correct across the per-phase title variants without a brittle exact map.
function whatThisStepDoes(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('where do you want to run')) return 'Pick how to run openagentic — local Docker or a Kubernetes cluster.';
  if (t.includes('cluster') || t.includes('kube')) return 'Check your kubeconfig + cluster access before a Helm install.';
  if (t.includes('admin account')) return 'Create the first admin user that you’ll sign in with.';
  if (t.includes('which llm provider')) return 'Choose which LLM backend the platform talks to.';
  if (t.includes('ollama')) return 'Point the platform at your Ollama host for local models.';
  if (t.includes('bedrock') || t.includes('aws')) return 'Use Amazon Bedrock models via your AWS account.';
  if (t.includes('vertex') || t.includes('gemini')) return 'Use Google Gemini models via your GCP project (Vertex AI).';
  if (t.includes('foundry') || t.includes('entra') || t.includes('azure')) return 'Use Azure AI Foundry models via your Azure endpoint.';
  if (t.includes('which mcps')) return 'Select which MCP tool servers to enable for your agents.';
  if (t.includes('credential')) return 'Provide the credentials this MCP needs to connect.';
  if (t.includes('review')) return 'Review your choices, write .env, and launch the stack.';
  if (t.includes('bringing up')) return 'Bringing the openagentic stack online.';
  return 'Step through the openagentic setup wizard.';
}

/** A `?` help overlay: a bordered card listing every keybinding with a gloss,
 *  a one-line description of the current step, and the step's docs link. */
export const Help: React.FC<{ title: string; onClose?: () => void }> = ({ title }) => {
  const doc = getDocFor(title);
  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={COLORS.signal}
        paddingX={2}
        paddingY={1}
      >
        <Text color={COLORS.signal} bold>
          ⌥  keys &amp; help
        </Text>
        <Box marginTop={1} flexDirection="column">
          {BINDINGS.map((b) => (
            <Box key={b.key}>
              <Box width={8}>
                <Text color={COLORS.accent} bold>
                  {b.key}
                </Text>
              </Box>
              <Text color={COLORS.ink}>{b.gloss}</Text>
            </Box>
          ))}
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={COLORS.muted}>this step</Text>
          <Text color={COLORS.ink}>{whatThisStepDoes(title)}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.faint}>📖 </Text>
          <Link url={doc.url} text={`${doc.label} →`} />
        </Box>
        <Box marginTop={1}>
          <Text color={COLORS.faint}>press ? or esc to close</Text>
        </Box>
      </Box>
    </Box>
  );
};

export default Help;
