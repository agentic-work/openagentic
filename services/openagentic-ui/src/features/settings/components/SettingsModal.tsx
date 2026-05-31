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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-[var(--color-surface)] rounded-xl p-6 w-full max-w-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
            Close
          </button>
        </div>
        <p className="text-gray-500">Settings panel content</p>
      </div>
    </div>
  );
};

export default SettingsModal;
