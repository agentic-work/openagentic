import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { rehypeSemanticTokens } from '@/features/shared/markdown/rehypeSemanticTokens';

const TEXT_COLOR = 'var(--cm-text, #e6edf3)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const SUCCESS = 'var(--cm-success, #3fb950)';
const ERROR_COLOR = 'var(--cm-error, #f85149)';
const PLAN_TONE = '#5faec1';

export type PlanApprovalRequestMessage = {
  type: 'plan_approval_request';
  from: string;
  planContent: string;
  planFilePath: string;
};

export type PlanApprovalResponseMessage = {
  type: 'plan_approval_response';
  approved: boolean;
  feedback?: string;
};

function tryParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isPlanApprovalRequest(content: string): PlanApprovalRequestMessage | null {
  const parsed = tryParseJson<{ type?: string }>(content);
  if (parsed?.type !== 'plan_approval_request') return null;
  return parsed as PlanApprovalRequestMessage;
}

function isPlanApprovalResponse(content: string): PlanApprovalResponseMessage | null {
  const parsed = tryParseJson<{ type?: string }>(content);
  if (parsed?.type !== 'plan_approval_response') return null;
  return parsed as PlanApprovalResponseMessage;
}

export const PlanApprovalRequestDisplay: React.FC<{
  request: PlanApprovalRequestMessage;
}> = ({ request }) => (
  <div
    data-part="plan_approval_request"
    className="cm-part cm-plan-approval-request"
    style={{ margin: '6px 0' }}
  >
    <div
      style={{
        border: `1px solid ${PLAN_TONE}`,
        borderRadius: 6,
        background: 'rgba(95, 174, 193, 0.06)',
        padding: 10,
      }}
    >
      <div style={{ color: PLAN_TONE, fontWeight: 600, marginBottom: 6 }}>
        Plan Approval Request from {request.from}
      </div>
      <div className="cm-markdown" style={{ color: TEXT_COLOR }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSemanticTokens]}>
          {request.planContent}
        </ReactMarkdown>
      </div>
      <div style={{ color: DIM, fontSize: 11, marginTop: 6 }}>
        Plan file: {request.planFilePath}
      </div>
    </div>
  </div>
);

export const PlanApprovalResponseDisplay: React.FC<{
  response: PlanApprovalResponseMessage;
  senderName: string;
}> = ({ response, senderName }) => {
  if (response.approved) {
    return (
      <div
        data-part="plan_approval_approved"
        className="cm-part cm-plan-approval-approved"
        style={{ margin: '6px 0' }}
      >
        <div
          style={{
            border: `1px solid ${SUCCESS}`,
            borderRadius: 6,
            background: 'rgba(63, 185, 80, 0.06)',
            padding: 10,
            color: TEXT_COLOR,
          }}
        >
          <div style={{ color: SUCCESS, fontWeight: 600 }}>
            ✓ Plan Approved by {senderName}
          </div>
          <div style={{ marginTop: 4, fontSize: 12 }}>
            You can now proceed with implementation. Your plan mode restrictions have
            been lifted.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-part="plan_approval_rejected"
      className="cm-part cm-plan-approval-rejected"
      style={{ margin: '6px 0' }}
    >
      <div
        style={{
          border: `1px solid ${ERROR_COLOR}`,
          borderRadius: 6,
          background: 'rgba(248, 81, 73, 0.06)',
          padding: 10,
          color: TEXT_COLOR,
        }}
      >
        <div style={{ color: ERROR_COLOR, fontWeight: 600 }}>
          ✗ Plan Rejected by {senderName}
        </div>
        {response.feedback && (
          <div
            style={{
              marginTop: 6,
              padding: '4px 6px',
              borderTop: `1px dashed ${DIM}`,
              borderBottom: `1px dashed ${DIM}`,
              fontSize: 12,
            }}
          >
            Feedback: {response.feedback}
          </div>
        )}
        <div style={{ marginTop: 6, color: DIM, fontSize: 11 }}>
          Please revise your plan based on the feedback and call ExitPlanMode again.
        </div>
      </div>
    </div>
  );
};

export function tryRenderPlanApprovalMessage(
  content: string,
  senderName: string,
): React.ReactNode | null {
  const request = isPlanApprovalRequest(content);
  if (request) return <PlanApprovalRequestDisplay request={request} />;
  const response = isPlanApprovalResponse(content);
  if (response) {
    return (
      <PlanApprovalResponseDisplay response={response} senderName={senderName} />
    );
  }
  return null;
}

function getPlanApprovalSummary(content: string): string | null {
  const request = isPlanApprovalRequest(content);
  if (request) return `[Plan Approval Request from ${request.from}]`;
  const response = isPlanApprovalResponse(content);
  if (response) {
    return response.approved
      ? '[Plan Approved] You can now proceed with implementation'
      : `[Plan Rejected] ${response.feedback || 'Please revise your plan'}`;
  }
  return null;
}

/**
 * Compact teammate message summarizer used by the attachment-list path.
 * Returns the original content untouched when nothing matches.
 */
export function formatTeammateMessageContent(content: string): string {
  const planSummary = getPlanApprovalSummary(content);
  if (planSummary) return planSummary;
  return content;
}

export default tryRenderPlanApprovalMessage;
