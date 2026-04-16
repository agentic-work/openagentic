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
      backgroundColor: 'rgba(0,0,0,0.7)',
      backdropFilter: 'blur(4px)',
      zIndex: 9999,
    }}>
      <div style={{
        width: 480,
        backgroundColor: '#161b22',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: 12,
        padding: 24,
        fontFamily: 'SF Mono, JetBrains Mono, monospace',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span style={{ fontSize: 16 }}>Approval Required</span>
          <span style={{
            fontSize: 10,
            color: '#d29922',
            backgroundColor: 'rgba(210,153,34,0.15)',
            padding: '2px 8px',
            borderRadius: 3,
            animation: 'pulse 2s ease-in-out infinite',
          }}>
            LLM PAUSED
          </span>
        </div>

        {/* Context */}
        {request.agentName && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>
            Agent: {request.agentName}
          </div>
        )}

        {/* Description */}
        <div style={{ fontSize: 12, color: '#e6edf3', marginBottom: 16 }}>
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
            <div style={{ color: 'rgba(255,255,255,0.4)' }}>Tool</div>
            <div style={{ color: '#e6edf3' }}>{request.tool}</div>
          </div>
          <div>
            <div style={{ color: 'rgba(255,255,255,0.4)' }}>Scope</div>
            <div style={{ color: '#e6edf3' }}>{request.scope}</div>
          </div>
          {Object.entries(request.metadata).map(([key, value]) => (
            <div key={key}>
              <div style={{ color: 'rgba(255,255,255,0.4)' }}>{key}</div>
              <div style={{ color: '#e6edf3' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Waiting indicator */}
        <div style={{
          fontSize: 11,
          color: '#d29922',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            backgroundColor: '#d29922',
            animation: 'pulse 1.5s ease-in-out infinite',
          }} />
          Waiting for approval...
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            onClick={() => onDeny(request.id)}
            style={{
              padding: '8px 20px',
              fontSize: 12,
              border: '1px solid #f85149',
              background: 'transparent',
              color: '#f85149',
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
              background: '#238636',
              color: '#ffffff',
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
