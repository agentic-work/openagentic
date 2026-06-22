import React from 'react';

interface HITLPopupProps {
  visible: boolean;
  request: {
    id: string;
    tool: string;
    description: string;
    scope: string;
    metadata: Record<string, string>;
    agentName?: string;
  };
  onApprove: (id: string) => void;
  onDeny: (id: string) => void;
}

export function HITLPopup({ visible, request, onApprove, onDeny }: HITLPopupProps) {
  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'color-mix(in srgb, var(--cm-bg) 70%, transparent)',
      backdropFilter: 'blur(4px)',
      zIndex: 9999,
    }}>
      <div style={{
        width: 480,
        backgroundColor: 'var(--cm-bg-secondary)',
        border: '1px solid var(--cm-border)',
        borderRadius: 12,
        padding: 24,
        fontFamily: 'SF Mono, JetBrains Mono, monospace',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 16 }}>Approval Required</span>
          <span style={{
            fontSize: 10,
            color: 'var(--cm-warning)',
            backgroundColor: 'color-mix(in srgb, var(--cm-warning) 15%, transparent)',
            padding: '2px 8px',
            borderRadius: 3,
            animation: 'pulse 2s ease-in-out infinite',
          }}>
            LLM PAUSED
          </span>
        </div>

        {/* Context */}
        {request.agentName && (
          <div style={{ fontSize: 11, color: 'var(--cm-text-secondary)', marginBottom: 8 }}>
            Agent: {request.agentName}
          </div>
        )}

        {/* Description */}
        <div style={{ fontSize: 12, color: 'var(--cm-text)', marginBottom: 16 }}>
          {request.description}
        </div>

        {/* Detail grid */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
          marginBottom: 20,
          fontSize: 11,
        }}>
          <div>
            <div style={{ color: 'var(--cm-text-muted)' }}>Tool</div>
            <div style={{ color: 'var(--cm-text)' }}>{request.tool}</div>
          </div>
          <div>
            <div style={{ color: 'var(--cm-text-muted)' }}>Scope</div>
            <div style={{ color: 'var(--cm-text)' }}>{request.scope}</div>
          </div>
          {Object.entries(request.metadata).map(([key, value]) => (
            <div key={key}>
              <div style={{ color: 'var(--cm-text-muted)' }}>{key}</div>
              <div style={{ color: 'var(--cm-text)' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Waiting indicator */}
        <div style={{
          fontSize: 11,
          color: 'var(--cm-warning)',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            backgroundColor: 'var(--cm-warning)',
            animation: 'pulse 1.5s ease-in-out infinite',
          }} />
          <span>Waiting for approval...</span>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            onClick={() => onDeny(request.id)}
            style={{
              padding: '8px 20px',
              fontSize: 12,
              border: '1px solid var(--cm-error)',
              background: 'transparent',
              color: 'var(--cm-error)',
              cursor: 'pointer',
              borderRadius: 6,
              fontFamily: 'inherit',
            }}
          >
            Deny
          </button>
          <button
            onClick={() => onApprove(request.id)}
            style={{
              padding: '8px 20px',
              fontSize: 12,
              border: 'none',
              background: 'var(--cm-success)',
              color: 'var(--cm-bg)',
              cursor: 'pointer',
              borderRadius: 6,
              fontFamily: 'inherit',
            }}
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
