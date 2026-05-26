import React from 'react';

import {
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  NO_CONTENT_MESSAGE,
} from '../../utils/messageSentinels';
import { extractTag } from '../../utils/extractTag';

import { UserAgentNotificationMessage } from './UserAgentNotificationMessage';
import { UserBashInputMessage } from './UserBashInputMessage';
import { UserBashOutputMessage } from './UserBashOutputMessage';
import { UserChannelMessage } from './UserChannelMessage';
import { UserCommandMessage } from './UserCommandMessage';
import { UserLocalCommandOutputMessage } from './UserLocalCommandOutputMessage';
import { UserMemoryInputMessage } from './UserMemoryInputMessage';
import { UserResourceUpdateMessage } from './UserResourceUpdateMessage';

const ERROR_COLOR = 'var(--cm-error, #f85149)';
const MONO_FONT =
  'var(--cm-mono-font, ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace)';

const TICK_TAG = 'tick';
const LOCAL_COMMAND_CAVEAT_TAG = 'local-command-caveat';

const InterruptedRow: React.FC = () => (
  <div
    data-part="interrupted"
    className="cm-part cm-interrupted"
    style={{
      padding: '4px 0',
      color: ERROR_COLOR,
      fontFamily: MONO_FONT,
      fontSize: 12,
      fontStyle: 'italic',
    }}
  >
    Interrupted by user
  </div>
);

export interface UserTextMessageDispatchProps {
  text: string;
  addMargin?: boolean;
}

export const UserTextMessageDispatch: React.FC<UserTextMessageDispatchProps> = ({
  text,
  addMargin,
}) => {
  if (text.trim() === NO_CONTENT_MESSAGE) return null;

  // `<tick>` tags are heartbeat sentinels — never rendered.
  if (extractTag(text, TICK_TAG)) return null;

  // Synthetic caveat messages — should be filtered upstream but defensively skip.
  if (text.includes(`<${LOCAL_COMMAND_CAVEAT_TAG}>`)) return null;

  // Bash output (stdout/stderr come at the start of the body).
  if (text.startsWith('<bash-stdout') || text.startsWith('<bash-stderr')) {
    return <UserBashOutputMessage text={text} />;
  }

  // Local command output.
  if (
    text.startsWith('<local-command-stdout') ||
    text.startsWith('<local-command-stderr')
  ) {
    return <UserLocalCommandOutputMessage text={text} />;
  }

  // Interrupt sentinels.
  if (text === INTERRUPT_MESSAGE || text === INTERRUPT_MESSAGE_FOR_TOOL_USE) {
    return <InterruptedRow />;
  }

  // Bash input.
  if (text.includes('<bash-input>')) {
    return <UserBashInputMessage text={text} addMargin={addMargin} />;
  }

  // Slash commands.
  if (text.includes('<command-message>')) {
    return <UserCommandMessage text={text} addMargin={addMargin} />;
  }

  // User memory input.
  if (text.includes('<user-memory-input>')) {
    return <UserMemoryInputMessage text={text} addMargin={addMargin} />;
  }

  // Task / agent completion notifications.
  if (text.includes('<task-notification')) {
    return <UserAgentNotificationMessage text={text} addMargin={addMargin} />;
  }

  // MCP resource and polling updates.
  if (text.includes('<mcp-resource-update') || text.includes('<mcp-polling-update')) {
    return <UserResourceUpdateMessage text={text} addMargin={addMargin} />;
  }

  // Inbound MCP-channel push.
  if (text.includes('<channel source="')) {
    return <UserChannelMessage text={text} addMargin={addMargin} />;
  }

  // Plain user text — caller renders the user bubble.
  return null;
};

export default UserTextMessageDispatch;
