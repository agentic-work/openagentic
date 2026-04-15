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