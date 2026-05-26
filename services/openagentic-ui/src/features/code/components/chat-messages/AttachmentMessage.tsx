import React from 'react';

import { tryRenderPlanApprovalMessage } from './PlanApprovalMessage';
import { tryRenderShutdownMessage } from './ShutdownMessage';
import { tryRenderTaskAssignmentMessage } from './TaskAssignmentMessage';
import { UserImageMessage } from './UserImageMessage';

const TEXT_COLOR = 'var(--cm-text, #e6edf3)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const ERROR_COLOR = 'var(--cm-error, #f85149)';
const WARNING = 'var(--cm-warning, #d29922)';
const BORDER = 'var(--cm-border, #30363d)';
const BG_SURFACE = 'var(--cm-bg-secondary, #161b22)';
const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

export type Diagnostic = {
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
};

export type Attachment =
  | { type: 'teammate_mailbox'; messages: Array<{ from: string; text: string; summary?: string }> }
  | { type: 'image'; imageId?: number; imageUrl?: string }
  | { type: 'diagnostics'; diagnostics: Diagnostic[] }
  | { type: 'shutdown'; content: string }
  | { type: string; [k: string]: unknown };

const DiagnosticsDisplay: React.FC<{ diagnostics: Diagnostic[] }> = ({
  diagnostics,
}) => {
  if (diagnostics.length === 0) return null;
  return (
    <div
      data-part="diagnostics"
      className="cm-part cm-diagnostics"
      style={{
        margin: '6px 0',
        padding: '4px 8px',
        background: BG_SURFACE,
        border: `1px solid ${BORDER}`,
        borderRadius: 3,
        fontFamily: MONO_FONT,
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <div style={{ color: DIM, fontSize: 11, marginBottom: 2 }}>
        {diagnostics.length} diagnostic{diagnostics.length === 1 ? '' : 's'}
      </div>
      {diagnostics.map((d, i) => (
        <div
          key={i}
          data-severity={d.severity}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
            color:
              d.severity === 'error'
                ? ERROR_COLOR
                : d.severity === 'warning'
                  ? WARNING
                  : TEXT_COLOR,
          }}
        >
          <span aria-hidden>
            {d.severity === 'error' ? '✕' : d.severity === 'warning' ? '⚠' : 'ℹ'}
          </span>
          {d.file && <span style={{ color: DIM }}>{d.file}{d.line ? `:${d.line}` : ''}</span>}
          <span>{d.message}</span>
        </div>
      ))}
    </div>
  );
};

const TeammateRow: React.FC<{ from: string; content: string; summary?: string }> = ({
  from,
  content,
  summary,
}) => (
  <div
    data-part="teammate_message"
    className="cm-part cm-teammate-message"
    style={{
      margin: '4px 0',
      color: TEXT_COLOR,
      fontFamily: MONO_FONT,
      fontSize: 12,
    }}
  >
    <div style={{ color: DIM, fontSize: 11 }}>@{from}</div>
    {summary && <div style={{ color: DIM }}>{summary}</div>}
    <div>{content}</div>
  </div>
);

export interface AttachmentMessageProps {
  attachment: Attachment;
  isTranscriptMode?: boolean;
}

export const AttachmentMessage: React.FC<AttachmentMessageProps> = ({
  attachment,
}) => {
  if (attachment.type === 'teammate_mailbox') {
    const messages = (attachment as Extract<Attachment, { type: 'teammate_mailbox' }>)
      .messages;
    if (messages.length === 0) return null;
    return (
      <div
        data-part="attachment_teammate_mailbox"
        className="cm-part cm-attachment-mailbox"
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        {messages.map((msg, i) => {
          const planNode = tryRenderPlanApprovalMessage(msg.text, msg.from);
          if (planNode) {
            return <React.Fragment key={i}>{planNode}</React.Fragment>;
          }
          const shutdownNode = tryRenderShutdownMessage(msg.text);
          if (shutdownNode) {
            return <React.Fragment key={i}>{shutdownNode}</React.Fragment>;
          }
          const taskNode = tryRenderTaskAssignmentMessage(msg.text);
          if (taskNode) {
            return <React.Fragment key={i}>{taskNode}</React.Fragment>;
          }
          // Plain teammate message — show the text with a sender header.
          return (
            <TeammateRow
              key={i}
              from={msg.from}
              content={msg.text}
              summary={msg.summary}
            />
          );
        })}
      </div>
    );
  }

  if (attachment.type === 'image') {
    const a = attachment as Extract<Attachment, { type: 'image' }>;
    return <UserImageMessage imageId={a.imageId} imageUrl={a.imageUrl} />;
  }

  if (attachment.type === 'diagnostics') {
    const a = attachment as Extract<Attachment, { type: 'diagnostics' }>;
    return <DiagnosticsDisplay diagnostics={a.diagnostics} />;
  }

  if (attachment.type === 'shutdown') {
    const a = attachment as Extract<Attachment, { type: 'shutdown' }>;
    const node = tryRenderShutdownMessage(a.content);
    return node ? <>{node}</> : null;
  }

  return null;
};

export default AttachmentMessage;
