import React from 'react';

const TEXT_COLOR = 'var(--cm-text, #e6edf3)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const WARNING = 'var(--cm-warning, #d29922)';

export type ShutdownRequestMessage = {
  type: 'shutdown_request';
  from: string;
  reason?: string;
};

export type ShutdownRejectedMessage = {
  type: 'shutdown_rejected';
  from: string;
  reason: string;
};

export type ShutdownApprovedMessage = {
  type: 'shutdown_approved';
  from: string;
};

function tryParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isShutdownRequest(content: string): ShutdownRequestMessage | null {
  const parsed = tryParseJson<{ type?: string }>(content);
  if (parsed?.type !== 'shutdown_request') return null;
  return parsed as ShutdownRequestMessage;
}

function isShutdownRejected(content: string): ShutdownRejectedMessage | null {
  const parsed = tryParseJson<{ type?: string }>(content);
  if (parsed?.type !== 'shutdown_rejected') return null;
  return parsed as ShutdownRejectedMessage;
}

function isShutdownApproved(content: string): ShutdownApprovedMessage | null {
  const parsed = tryParseJson<{ type?: string }>(content);
  if (parsed?.type !== 'shutdown_approved') return null;
  return parsed as ShutdownApprovedMessage;
}

export const ShutdownRequestDisplay: React.FC<{
  request: ShutdownRequestMessage;
}> = ({ request }) => (
  <div
    data-part="shutdown_request"
    className="cm-part cm-shutdown-request"
    style={{ margin: '6px 0' }}
  >
    <div
      style={{
        border: `1px solid ${WARNING}`,
        borderRadius: 6,
        background: 'rgba(210, 153, 34, 0.06)',
        padding: 10,
        color: TEXT_COLOR,
      }}
    >
      <div style={{ color: WARNING, fontWeight: 600 }}>
        Shutdown request from {request.from}
      </div>
      {request.reason && (
        <div style={{ marginTop: 4, fontSize: 12 }}>Reason: {request.reason}</div>
      )}
    </div>
  </div>
);

export const ShutdownRejectedDisplay: React.FC<{
  response: ShutdownRejectedMessage;
}> = ({ response }) => (
  <div
    data-part="shutdown_rejected"
    className="cm-part cm-shutdown-rejected"
    style={{ margin: '6px 0' }}
  >
    <div
      style={{
        border: `1px solid ${DIM}`,
        borderRadius: 6,
        padding: 10,
        color: TEXT_COLOR,
      }}
    >
      <div style={{ color: DIM, fontWeight: 600 }}>
        Shutdown rejected by {response.from}
      </div>
      <div style={{ marginTop: 4, fontSize: 12 }}>Reason: {response.reason}</div>
      <div style={{ marginTop: 6, color: DIM, fontSize: 11 }}>
        Teammate is continuing to work. You may request shutdown again later.
      </div>
    </div>
  </div>
);

export function tryRenderShutdownMessage(content: string): React.ReactNode | null {
  const request = isShutdownRequest(content);
  if (request) return <ShutdownRequestDisplay request={request} />;
  if (isShutdownApproved(content)) return null;
  const rejected = isShutdownRejected(content);
  if (rejected) return <ShutdownRejectedDisplay response={rejected} />;
  return null;
}

export function getShutdownMessageSummary(content: string): string | null {
  const request = isShutdownRequest(content);
  if (request) {
    return `[Shutdown Request from ${request.from}]${
      request.reason ? ` ${request.reason}` : ''
    }`;
  }
  const approved = isShutdownApproved(content);
  if (approved) return `[Shutdown Approved] ${approved.from} is now exiting`;
  const rejected = isShutdownRejected(content);
  if (rejected) return `[Shutdown Rejected] ${rejected.from}: ${rejected.reason}`;
  return null;
}

export default tryRenderShutdownMessage;
