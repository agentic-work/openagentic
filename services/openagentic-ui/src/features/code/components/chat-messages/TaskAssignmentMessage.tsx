import React from 'react';

const TEXT_COLOR = 'var(--cm-text, #e6edf3)';
const DIM = 'var(--cm-text-muted, #8b949e)';
const TASK_TONE = '#5fb1c1';

export type TaskAssignmentMessage = {
  type: 'task_assignment';
  taskId: string;
  subject: string;
  assignedBy: string;
  description?: string;
};

function tryParseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isTaskAssignment(content: string): TaskAssignmentMessage | null {
  const parsed = tryParseJson<{ type?: string }>(content);
  if (parsed?.type !== 'task_assignment') return null;
  return parsed as TaskAssignmentMessage;
}

export const TaskAssignmentDisplay: React.FC<{
  assignment: TaskAssignmentMessage;
}> = ({ assignment }) => (
  <div
    data-part="task_assignment"
    className="cm-part cm-task-assignment"
    style={{ margin: '6px 0' }}
  >
    <div
      style={{
        border: `1px solid ${TASK_TONE}`,
        borderRadius: 6,
        background: 'rgba(95, 177, 193, 0.06)',
        padding: 10,
        color: TEXT_COLOR,
      }}
    >
      <div style={{ color: TASK_TONE, fontWeight: 600, marginBottom: 4 }}>
        Task #{assignment.taskId} assigned by {assignment.assignedBy}
      </div>
      <div style={{ fontWeight: 600 }}>{assignment.subject}</div>
      {assignment.description && (
        <div style={{ marginTop: 4, color: DIM, fontSize: 12 }}>
          {assignment.description}
        </div>
      )}
    </div>
  </div>
);

export function tryRenderTaskAssignmentMessage(
  content: string,
): React.ReactNode | null {
  const assignment = isTaskAssignment(content);
  if (assignment) return <TaskAssignmentDisplay assignment={assignment} />;
  return null;
}

export function getTaskAssignmentSummary(content: string): string | null {
  const assignment = isTaskAssignment(content);
  if (assignment) {
    return `[Task Assigned] #${assignment.taskId} - ${assignment.subject}`;
  }
  return null;
}

export default TaskAssignmentDisplay;
