/**
 * #781 Phase C2 — ReactApp renderer.
 *
 * Wraps the existing v2/AppRenderer iframe inside the new artifact
 * slide-out. AppRenderer already handles the hardened sandbox (allow-
 * scripts only, CSP via srcdoc, optional Pyodide bootstrap, postMessage
 * auto-fit). We just delegate to it and add the slide-out's empty/error
 * state surfaces.
 */
import React from 'react';
import { AppRenderer } from '../../v2/AppRenderer.js';

export interface ReactAppProps {
  artifactId: string;
  html: string;
  title: string;
  pyodideRequired?: boolean;
  nonce?: string | null;
}

export const ReactApp: React.FC<ReactAppProps> = ({
  artifactId,
  html,
  title,
  pyodideRequired,
  nonce,
}) => {
  if (!html || !html.trim()) {
    return (
      <div
        data-testid="react-app-empty"
        style={{
          padding: '40px 20px',
          textAlign: 'center',
          color: 'var(--graphite, rgba(13,13,12,0.55))',
          fontFamily: 'var(--font-mono, ui-monospace, monospace)',
          fontSize: '12px',
          letterSpacing: '0.04em',
        }}
      >
        compose_app emitted no html payload.
      </div>
    );
  }
  return (
    <div data-testid="react-app-root" style={{ width: '100%', height: '100%' }}>
      <AppRenderer
        artifactId={artifactId}
        html={html}
        title={title}
        pyodideRequired={pyodideRequired}
        nonce={nonce ?? null}
        maxHeight="100%"
      />
    </div>
  );
};
