import React from 'react';
import EnhancedMCPDisplay from './EnhancedMCPDisplay';

// Legacy wrapper for backward compatibility
interface MCPCallDisplayProps {
  calls: any[];
  theme: 'light' | 'dark';
}

const MCPCallDisplay: React.FC<MCPCallDisplayProps> = ({ calls, theme }) => {
  return <EnhancedMCPDisplay calls={calls} theme={theme} />;
};

export default MCPCallDisplay;