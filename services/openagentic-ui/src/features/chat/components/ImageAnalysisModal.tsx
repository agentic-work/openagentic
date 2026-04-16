/**
 * Memoized Image Analysis Modal Component
 * Optimized for performance with React.memo to prevent unnecessary re-renders
 */

import React, { Suspense, memo } from 'react';

// Lazy load the ImageAnalysis component
const ImageAnalysis = React.lazy(() => import('@/features/chat/components/ImageAnalysis'));

interface ImageAnalysisModalProps {
  showImageAnalysis: boolean;
  currentImageForAnalysis: File | null;
  onAnalysisComplete: (result: any) => void;
  onClose: () => void;
  theme: string;
}

const ImageAnalysisModal = memo<ImageAnalysisModalProps>(({
  showImageAnalysis,
  currentImageForAnalysis,
  onAnalysisComplete,
  onClose,
  theme
}) => {
  if (!showImageAnalysis || !currentImageForAnalysis) return null;

  return (
    <div
      
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'var(--color-background)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-4xl mx-4 h-[80vh]" onClick={(e) => e.stopPropagation()}>
        <Suspense fallback={<div className="flex items-center justify-center h-full">Loading Image Analysis...</div>}>
          <ImageAnalysis
            file={currentImageForAnalysis}
            onAnalysisComplete={onAnalysisComplete}
            onClose={onClose}
            theme={theme as 'light' | 'dark'}
            className="w-full h-full"
          />
        </Suspense>
      </div>
    </div>
  );
});

ImageAnalysisModal.displayName = 'ImageAnalysisModal';

export default ImageAnalysisModal;