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
 * Component for rendering highlighted text with different colors
 * Updated to use CSS variables for consistent theming
 */

import React from 'react';

interface HighlightedTextProps {
  text: string;
  color?: 'yellow' | 'green' | 'blue' | 'red' | 'orange';
}

const HighlightedText: React.FC<HighlightedTextProps> = ({ text, color = 'yellow' }) => {
  const getHighlightColors = () => {
    // Return CSS variable-based colors
    const colors = {
      yellow: { bg: '#fef3c7', fg: '#92400e' },
      green: { bg: '#d1fae5', fg: '#065f46' },
      blue: { bg: '#dbeafe', fg: '#1e40af' },
      red: { bg: '#fee2e2', fg: '#991b1b' },
      orange: { bg: '#fed7aa', fg: '#9a3412' }
    };

    return colors[color];
  };

  const { bg, fg } = getHighlightColors();

  return (
    <mark
      className="px-1 py-0.5 rounded"
      style={{ backgroundColor: bg, color: fg }}
    >
      {text}
    </mark>
  );
};

export default HighlightedText;