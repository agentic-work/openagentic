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