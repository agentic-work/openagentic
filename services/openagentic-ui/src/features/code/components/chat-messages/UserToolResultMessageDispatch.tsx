import React from 'react';

import {
  CANCEL_MESSAGE,
  REJECT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
} from '../../utils/messageSentinels';

import { UserToolCanceledMessage } from './UserToolCanceledMessage';
import { UserToolErrorMessage } from './UserToolErrorMessage';
import { UserToolRejectMessage } from './UserToolRejectMessage';

export interface UserToolResultMessageDispatchProps {
  content: string;
  isError: boolean;
}

export const UserToolResultMessageDispatch: React.FC<
  UserToolResultMessageDispatchProps
> = ({ content, isError }) => {
  if (typeof content === 'string' && content.startsWith(CANCEL_MESSAGE)) {
    return <UserToolCanceledMessage />;
  }

  if (
    (typeof content === 'string' && content.startsWith(REJECT_MESSAGE)) ||
    content === INTERRUPT_MESSAGE_FOR_TOOL_USE
  ) {
    return <UserToolRejectMessage />;
  }

  if (isError) {
    return <UserToolErrorMessage content={content} />;
  }

  return null;
};

export default UserToolResultMessageDispatch;
