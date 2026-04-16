import React from 'react';

interface ImageAnalysisProps {
  file?: File;
  imageUrl?: string;
  onClose?: () => void;
  onAnalysisComplete?: (result: any) => void;
  theme?: 'light' | 'dark';
  className?: string;
}

const ImageAnalysis: React.FC<ImageAnalysisProps> = ({ file, imageUrl, onClose, onAnalysisComplete, theme, className }) => {
  return (
    <div className="image-analysis">
      {/* Image analysis component - placeholder */}
      <div>Image Analysis</div>
    </div>
  );
};

export default ImageAnalysis;