import React from 'react';
import { Box, Text } from 'ink';
import { COLORS } from './Theme.tsx';

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * WizardErrorBoundary — React class error boundary for the Ink TUI wizard.
 *
 * A render-time throw anywhere inside the wizard tree would otherwise tear
 * Ink down with a raw stack trace mid-screen. This catches it and renders a
 * calm, branded fallback with concrete next steps, instead of a crash dump.
 *
 * React error boundaries MUST be class components (there is no hook
 * equivalent for getDerivedStateFromError / componentDidCatch). Process-level
 * failures (uncaughtException / unhandledRejection) are handled separately by
 * the bail() handlers installed in index.tsx — this only covers render throws.
 */
export class WizardErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(): void {
    // The error is already captured into state by getDerivedStateFromError;
    // the fallback UI is rendered from render(). No side effects needed here.
  }

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <Box flexDirection="column" paddingX={1} paddingY={1}>
        <Text color={COLORS.err} bold>
          ✗ The setup wizard hit an unexpected error
        </Text>
        <Box marginTop={1}>
          <Text color={COLORS.ink}>{error.message || String(error)}</Text>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text color={COLORS.muted}>
            Retry the wizard, or fall back to a non-interactive install:
          </Text>
          <Text color={COLORS.faint}>  Quick (Ollama):  ./install.sh --quick</Text>
          <Text color={COLORS.faint}>  From a .env:     ./install.sh --env ./my.env</Text>
          <Text color={COLORS.faint}>  Help:            https://openagentics.io/docs/troubleshooting</Text>
          <Text color={COLORS.faint}>  Issues:          https://github.com/agentic-work/openagentic/issues</Text>
        </Box>
      </Box>
    );
  }
}

export default WizardErrorBoundary;
