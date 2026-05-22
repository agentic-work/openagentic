import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { rehypeSemanticTokens } from '@/features/shared/markdown/rehypeSemanticTokens';

const DIM = 'var(--cm-text-muted, #8b949e)';
const PLAN_TONE = '#5faec1';

export interface RejectedPlanMessageProps {
  plan: string;
}

export const RejectedPlanMessage: React.FC<RejectedPlanMessageProps> = ({
  plan,
}) => (
  <div
    data-part="tool_result_plan_rejected"
    className="cm-part cm-plan-rejected"
    style={{ margin: '6px 0' }}
  >
    <div style={{ color: DIM, fontSize: 12, marginBottom: 4 }}>
      User rejected the plan:
    </div>
    <div
      style={{
        border: `1px solid ${PLAN_TONE}`,
        borderRadius: 6,
        background: 'rgba(95, 174, 193, 0.06)',
        padding: 10,
      }}
    >
      <div className="cm-markdown">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSemanticTokens]}>
          {plan}
        </ReactMarkdown>
      </div>
    </div>
  </div>
);

export default RejectedPlanMessage;
