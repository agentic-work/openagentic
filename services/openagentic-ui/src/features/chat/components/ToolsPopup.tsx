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
import { Wrench, X } from '@/shared/icons';

interface ToolsPopupProps {
  isOpen: boolean;
  onClose: () => void;
  availableTools: any[];
  theme: 'light' | 'dark';
}

const ToolsPopup: React.FC<ToolsPopupProps> = ({ isOpen, onClose, availableTools, theme }) => {
  if (!isOpen) return null;

  return (
    <div 
    className="absolute bottom-full left-0 mb-2 border rounded-lg shadow-lg p-4 w-80 z-50"
    style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Wrench className="w-4 h-4" />
          <h3 className="text-sm font-semibold">Available Tools</h3>
        </div>
        <button 
          onClick={onClose}
          
          className="hover:text-gray-600 :text-gray-300"
          style={{ color: 'var(--color-textMuted)' }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      
      <div className="space-y-2">
        {availableTools.length > 0 ? (
          availableTools.map((tool, index) => (
            <div key={index} 
            className="flex items-center gap-2 p-2 rounded"
            style={{ backgroundColor: 'var(--color-surface)' }}>
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span className="text-sm">{tool.name || tool}</span>
            </div>
          ))
        ) : (
          <p 
          className="text-sm"
          style={{ color: 'var(--color-textSecondary)' }}>No tools available</p>
        )}
      </div>
    </div>
  );
};

export default ToolsPopup;