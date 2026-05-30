/**
 * NodeDocsPanel — TDD-driven, written one test at a time.
 *
 * Iron-law discipline: render only what already-written tests require.
 * Renders schema.ai docs + I/O ports + outputAssertions for the
 * currently-selected schema-driven node.
 */

import React from 'react';
import type { RegistryNodeSchema } from '../services/nodeSchemasApi';

export interface NodeDocsPanelProps {
  schema: RegistryNodeSchema | null;
}

export const NodeDocsPanel: React.FC<NodeDocsPanelProps> = ({ schema }) => {
  if (!schema) {
    return (
      <div data-testid="node-docs-empty" style={{ padding: 16, fontSize: 12, color: 'var(--color-text-tertiary, #999)' }}>
        No schema-driven docs are available for this node.
      </div>
    );
  }
  return (
    <div style={{ padding: 16, fontSize: 12, color: 'var(--color-text, #e6edf3)' }}>
      {schema.ai?.shortDescription && (
        <p style={{ marginBottom: 12 }}>{schema.ai.shortDescription}</p>
      )}
      {schema.ai?.whenToUse && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-tertiary, #999)', marginBottom: 4 }}>
            When to use
          </div>
          <p>{schema.ai.whenToUse}</p>
        </div>
      )}
      {(schema.ports?.inputs?.length ?? 0) + (schema.ports?.outputs?.length ?? 0) > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-tertiary, #999)', marginBottom: 4 }}>
            Inputs &amp; outputs
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {(schema.ports?.inputs ?? []).map((p: any) => (
              <li key={`in-${p.name}`} style={{ padding: '2px 0', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11 }}>
                <span style={{ color: '#22c55e' }}>in</span> · {p.name} : <span style={{ color: 'var(--color-text-tertiary, #999)' }}>{p.type}</span>{p.required ? ' *' : ''}
              </li>
            ))}
            {(schema.ports?.outputs ?? []).map((p: any) => (
              <li key={`out-${p.name}`} style={{ padding: '2px 0', fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11 }}>
                <span style={{ color: '#2196f3' }}>out</span> · {p.name} : <span style={{ color: 'var(--color-text-tertiary, #999)' }}>{p.type}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {(schema.outputAssertions?.length ?? 0) > 0 && (
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-tertiary, #999)', marginBottom: 4 }}>
            Output assertions
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {(schema.outputAssertions ?? []).map((a: any) => (
              <li key={a.name} style={{ marginBottom: 6 }}>
                <div style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 11, color: '#fbbf24', fontWeight: 600 }}>
                  {a.name}
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary, #8b949e)' }}>
                  {a.errorMessage}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
