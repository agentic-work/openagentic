/**
 * Image Viewer Modal Component
 * Placeholder component for documentation image viewing
 */

import React from 'react';
import { onKeyActivate } from '@/utils/a11y';

export interface ImageViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl?: string;
  imageType?: 'image' | 'diagram';
  imageAlt?: string;
}

export const ImageViewerModal: React.FC<ImageViewerModalProps> = ({ isOpen, onClose, imageUrl }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'color-mix(in srgb, var(--color-bg) 80%, transparent)' }} role="button" tabIndex={0} aria-label="Close" onClick={onClose} onKeyDown={onKeyActivate(onClose)}>
      <div className="max-w-4xl max-h-screen p-4">
        {imageUrl && <img src={imageUrl} alt="Documentation" className="max-w-full max-h-full" />}
      </div>
    </div>
  );
};

export default ImageViewerModal;
