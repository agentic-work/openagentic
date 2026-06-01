/**
 * SettingsModal - Full settings modal component
 * Placeholder for the settings modal overlay
 */

import React from 'react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings?: any;
  onSettingsChange?: (settings: any) => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--color-bg) 60%, transparent)' }}>
      <div className="bg-surface border-ink shadow-hard p-6 w-full max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text">Settings</h2>
          <button onClick={onClose} className="text-text-muted hover:text-text">
            Close
          </button>
        </div>
        <p className="text-text-muted">Settings panel content</p>
      </div>
    </div>
  );
};

export default SettingsModal;
