/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Code Mode component exports
 *
 * V2 Openagentic Style - Pure React implementation
 */

// Main entry point
export { CodeModePage } from './CodeModePage';

// V2 Layout (Openagentic Style)
export { CodeModeLayoutV2 } from './CodeModeLayoutV2';

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
export { EditorPanel, type EditorPanelProps, type EditorPanelTab } from './EditorPanel';
