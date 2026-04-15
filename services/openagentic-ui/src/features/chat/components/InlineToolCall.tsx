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

 * For all inquiries, please contact:
 * 

 * hello@openagentics.io
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from '@/shared/icons';

interface InlineToolCallProps {
  toolName: string;
  args?: any;
  result?: any;
  status?: 'calling' | 'complete' | 'error';
  theme: 'light' | 'dark';
}

export const InlineToolCall: React.FC<InlineToolCallProps> = ({
  toolName,
  args,
  result,
  status = 'complete',
  theme
}) => {
  const [showDetails, setShowDetails] = useState(false);

  const borderColor = 'border-border-primary';
  const bgColor = 'bg-bg-secondary/50';
  const textColor = 'text-text-primary';
  const codeBlockBg = 'bg-bg-tertiary';

  return (
    <div className={`my-2 border ${borderColor} rounded-md overflow-hidden`}>
      {/* Tool call header - matches Claude's style */}
      <div 
        className={`px-3 py-2 ${bgColor} flex items-center gap-2 cursor-pointer hover:opacity-90 transition-opacity`}
        onClick={() => setShowDetails(!showDetails)}
      >
        <button className="flex items-center gap-1">
          {showDetails ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </button>
        <span className={`text-sm font-medium ${textColor}`}>
          {status === 'calling' ? 'Calling' : 'Called'} function: <code className="font-mono text-sm">{toolName}</code>
        </span>
      </div>

      {/* Expandable details section */}
      {showDetails && (
        <div className={`border-t ${borderColor}`}>
          {/* Arguments section */}
          {args && (
            <div className={`px-3 py-2 border-b ${borderColor}`}>
              <div className={`text-xs font-medium ${textColor} mb-1`}>Arguments:</div>
              <pre className={`${codeBlockBg} p-2 rounded text-xs overflow-x-auto`}>
                <code className={textColor}>{JSON.stringify(args, null, 2)}</code>
              </pre>
            </div>
          )}

          {/* Result section */}
          {result !== undefined && status === 'complete' && (
            <div className="px-3 py-2">
              <div className={`text-xs font-medium ${textColor} mb-1`}>Result:</div>
              <pre className={`${codeBlockBg} p-2 rounded text-xs overflow-x-auto`}>
                <code className={textColor}>
                  {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
                </code>
              </pre>
            </div>
          )}

          {/* Error section */}
          {status === 'error' && result && (
            <div className="px-3 py-2">
              <div className="text-xs font-medium text-red-500 mb-1">Error:</div>
              <pre className={`${codeBlockBg} p-2 rounded text-xs overflow-x-auto`}>
                <code className="text-red-400">{result}</code>
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
