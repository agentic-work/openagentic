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

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

const Tooltip: React.FC<TooltipProps> = ({ content, children, position = 'top' }) => {
  return (
    <div className="relative group">
      {children}
      <div className={`absolute z-50 px-2 py-1 text-xs text-white bg-gray-900 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap ${
        position === 'top' ? 'bottom-full mb-1' :
        position === 'bottom' ? 'top-full mt-1' :
        position === 'left' ? 'right-full mr-1' :
        'left-full ml-1'
      }`}>
        {content}
        <div className={`absolute w-1 h-1 bg-gray-900 transform rotate-45 ${
          position === 'top' ? 'top-full -mt-0.5' :
          position === 'bottom' ? 'bottom-full -mb-0.5' :
          position === 'left' ? 'left-full -ml-0.5' :
          'right-full -mr-0.5'
        }`} />
      </div>
    </div>
  );
};

export default Tooltip;