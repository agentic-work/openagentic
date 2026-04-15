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