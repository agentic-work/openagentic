/**
 * Image Viewer Modal Component
 * Placeholder component for documentation image viewing
 */

import React from 'react';

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
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50" onClick={onClose}>
      <div className="max-w-4xl max-h-screen p-4">
        {imageUrl && <img src={imageUrl} alt="Documentation" className="max-w-full max-h-full" />}
      </div>
    </div>
  );
};

export default ImageViewerModal;
