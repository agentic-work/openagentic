/**
 * CredentialsContent — workflow secrets are stored server-side and referenced
 * as {{secret:name}} in any node. The execution engine resolves them at
 * runtime.
 */

import React from 'react';

export const CredentialsContent: React.FC<{ workflowId?: string }> = (_props) => (
  <div className="py-12 text-center">
    <div className="text-base font-semibold mb-2" style={{ color: 'var(--color-text)' }}>
      Workflow secrets
    </div>
    <div className="text-sm max-w-md mx-auto" style={{ color: 'var(--color-text-tertiary)' }}>
      Secrets are stored server-side and referenced as{' '}
      <code style={{ color: 'var(--color-text-secondary)' }}>{'{{secret:name}}'}</code> in any node.
      The execution engine resolves them at runtime.
    </div>
  </div>
);
