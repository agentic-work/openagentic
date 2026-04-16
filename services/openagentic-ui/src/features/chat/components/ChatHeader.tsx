import React from 'react';
import ExportButton from './ExportButton';
import { ChatMessage } from '@/types';

interface ChatHeaderProps {
  title: string;
  theme?: 'light' | 'dark';
  messages?: ChatMessage[];
  showExport?: boolean;
}

const ChatHeader: React.FC<ChatHeaderProps> = ({
  title,
  theme = 'dark',
  messages = [],
  showExport = true
}) => {
  return (
    <div className="flex items-center justify-between p-4 border-b bg-bg-secondary border-border-primary">
      <h1 className="text-lg font-semibold text-text-primary">
        {title}
      </h1>
      {showExport && messages.length > 0 && (
        <ExportButton
          messages={messages}
          sessionTitle={title}
          theme={theme}
        />
      )}
    </div>
  );
};

export default ChatHeader;