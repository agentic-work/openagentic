/**
 * Code Mode component exports
 *
 * V2 Openagentic Style - Pure React implementation
 */

// Main entry point
export { CodeModePage } from './CodeModePage';

// V2 Layout (Openagentic Style)
export { CodeModeLayout } from './CodeModeLayout';

// V2 Components
export { CodeModeStatusBar } from './CodeModeStatusBar';
export { CodeModeInputToolbar } from './CodeModeInputToolbar';
// InlineToolBlock + its dependencies (CLIBashDisplay, CLIDiffDisplay)
// were removed in the Phase 1 cleanup. They were leftovers from the
// pre-PTY architecture where openagentic-manager translated CLI tool
// events into structured React displays. The current runtime path is
// xterm.js ↔ PTY ↔ openagentic CLI directly, so structured tool blocks
// have no consumer. If a future phase reintroduces structured event
// overlays they should be designed against the new wire protocol, not
// resurrected from this dead code.
export { CLIThinkingDisplay } from './CLIThinkingDisplay';
export { InlineTodoList, TodoStatusBadge as InlineTodoStatusBadge } from './InlineTodoList';
export { ActiveTaskBar, ActiveTaskBadge } from './ActiveTaskBar';
export {
  StreamingActivityIndicator,
  InlineStreamingCursor,
  ActivityStatusPill,
} from './StreamingActivityIndicator';
export { PermissionApprovalDialog, type PermissionRequest, type PermissionDecision } from './PermissionApprovalDialog';

// Utility components
export { TodoList, TodoStatusBadge } from './TodoList';
