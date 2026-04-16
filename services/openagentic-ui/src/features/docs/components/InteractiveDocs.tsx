/**
 * Interactive Documentation Page
 * Main documentation landing page for the application
 */

import React from 'react';
import { Book } from '@/shared/icons';

interface InteractiveDocsProps {
  theme?: {
    background: string;
    text: string;
    textSecondary: string;
    border: string;
    cardBg: string;
  };
}

const InteractiveDocs: React.FC<InteractiveDocsProps> = ({ theme }) => {
  return (
    <div className="min-h-screen p-8" style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}>
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Book size={32} style={{ color: 'var(--color-primary)' }} />
          <h1 className="text-3xl font-bold">Documentation</h1>
        </div>

        <div className="glass-card p-6">
          <p style={{ color: 'var(--color-textMuted)' }}>
            Documentation is currently being developed. Please check back soon.
          </p>
        </div>
      </div>
    </div>
  );
};

export default InteractiveDocs;
