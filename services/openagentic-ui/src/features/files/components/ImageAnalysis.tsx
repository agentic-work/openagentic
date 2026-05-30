/**
 * Image Analysis Component
 * 
 * Provides image analysis capabilities including:
 * - OCR text extraction
 * - Object detection
 * - Image description
 * - Metadata extraction
 */

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Image, FileText, Eye, Info, Loader2, X, 
  ZoomIn, ZoomOut, RotateCw, Download, Share2 
} from '@/shared/icons';
import clsx from 'clsx';

interface ImageAnalysisResult {
  text?: string;
  objects?: Array<{ name: string; confidence: number; bbox?: number[] }>;
  description?: string;
  metadata?: {
    width: number;
    height: number;
    format: string;
    size: number;
  };
  tags?: string[];
}

interface ImageAnalysisProps {
  file?: File;
  imageUrl?: string;
  onAnalysisComplete?: (result: ImageAnalysisResult) => void;
  onClose?: () => void;
  className?: string;
  theme?: 'light' | 'dark';
}

export const ImageAnalysis: React.FC<ImageAnalysisProps> = ({
  file,
  imageUrl,
  onAnalysisComplete,
  onClose,
  className,
  theme = 'dark'
}) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<ImageAnalysisResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>(imageUrl || '');
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [activeTab, setActiveTab] = useState<'preview' | 'text' | 'objects' | 'metadata'>('preview');

  // Create preview URL from file
  React.useEffect(() => {
    if (file && !imageUrl) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [file, imageUrl]);

  const analyzeImage = useCallback(async () => {
    setIsAnalyzing(true);
    
    // Simulate image analysis (in production, this would call an API)
    setTimeout(() => {
      const mockResult: ImageAnalysisResult = {
        text: 'Sample extracted text from the image...',
        objects: [
          { name: 'person', confidence: 0.95 },
          { name: 'laptop', confidence: 0.87 },
          { name: 'coffee cup', confidence: 0.72 }
        ],
        description: 'A person working on a laptop with a coffee cup nearby',
        metadata: {
          width: 1920,
          height: 1080,
          format: file?.type || 'image/jpeg',
          size: file?.size || 0
        },
        tags: ['indoor', 'workspace', 'technology', 'productivity']
      };
      
      setAnalysisResult(mockResult);
      setIsAnalyzing(false);
      
      if (onAnalysisComplete) {
        onAnalysisComplete(mockResult);
      }
    }, 2000);
  }, [file, onAnalysisComplete]);

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.25, 0.5));
  const handleRotate = () => setRotation(prev => (prev + 90) % 360);

  const downloadImage = useCallback(() => {
    if (previewUrl) {
      const a = document.createElement('a');
      a.href = previewUrl;
      a.download = file?.name || 'image.jpg';
      a.click();
    }
  }, [previewUrl, file]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className={clsx(
        'rounded-lg border overflow-hidden',
        theme === 'dark' 
          ? 'bg-gray-800 border-gray-700' 
          : 'bg-white border-gray-200',
        className
      )}
    >
      {/* Header */}
      <div className={clsx(
        'flex items-center justify-between p-4 border-b',
        theme === 'dark' ? 'border-gray-700' : 'border-gray-200'
      )}>
        <div className="flex items-center gap-2">
          <Image className="w-5 h-5" />
          <span className="font-medium">Image Analysis</span>
        </div>
        <div className="flex items-center gap-2">
          {!isAnalyzing && !analysisResult && (
            <button
              onClick={analyzeImage}
              className={clsx(
                'px-3 py-1 rounded-md text-sm font-medium transition-colors',
                theme === 'dark'
                  ? 'bg-blue-600 hover:bg-blue-700 text-white'
                  : 'bg-blue-500 hover:bg-blue-600 text-white'
              )}
            >
              Analyze
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className={clsx(
                'p-1 rounded-md transition-colors',
                theme === 'dark'
                  ? 'hover:bg-gray-700 text-gray-400'
                  : 'hover:bg-gray-100 text-gray-600'
              )}
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      {analysisResult && (
        <div className={clsx(
          'flex border-b',
          theme === 'dark' ? 'border-gray-700' : 'border-gray-200'
        )}>
          {(['preview', 'text', 'objects', 'metadata'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={clsx(
                'px-4 py-2 text-sm font-medium capitalize transition-colors',
                activeTab === tab
                  ? theme === 'dark'
                    ? 'bg-gray-700 text-white'
                    : 'bg-gray-100 text-gray-900'
                  : theme === 'dark'
                    ? 'text-gray-400 hover:text-gray-200'
                    : 'text-gray-600 hover:text-gray-900'
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="p-4">
        {isAnalyzing && (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin mb-4" />
            <p className="text-sm opacity-60">Analyzing image...</p>
          </div>
        )}

        {!isAnalyzing && previewUrl && activeTab === 'preview' && (
          <div className="space-y-4">
            {/* Image controls */}
            <div className="flex items-center justify-center gap-2">
              <button
                onClick={handleZoomOut}
                className={clsx(
                  'p-2 rounded-md transition-colors',
                  theme === 'dark'
                    ? 'hover:bg-gray-700 text-gray-400'
                    : 'hover:bg-gray-100 text-gray-600'
                )}
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-sm px-2">{Math.round(zoom * 100)}%</span>
              <button
                onClick={handleZoomIn}
                className={clsx(
                  'p-2 rounded-md transition-colors',
                  theme === 'dark'
                    ? 'hover:bg-gray-700 text-gray-400'
                    : 'hover:bg-gray-100 text-gray-600'
                )}
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                onClick={handleRotate}
                className={clsx(
                  'p-2 rounded-md transition-colors',
                  theme === 'dark'
                    ? 'hover:bg-gray-700 text-gray-400'
                    : 'hover:bg-gray-100 text-gray-600'
                )}
              >
                <RotateCw className="w-4 h-4" />
              </button>
              <button
                onClick={downloadImage}
                className={clsx(
                  'p-2 rounded-md transition-colors',
                  theme === 'dark'
                    ? 'hover:bg-gray-700 text-gray-400'
                    : 'hover:bg-gray-100 text-gray-600'
                )}
              >
                <Download className="w-4 h-4" />
              </button>
            </div>

            {/* Image preview */}
            <div className="flex justify-center overflow-hidden rounded-lg">
              <img
                src={previewUrl}
                alt="Preview"
                style={{
                  transform: `scale(${zoom}) rotate(${rotation}deg)`,
                  transition: 'transform 0.3s ease'
                }}
                className="max-w-full h-auto"
              />
            </div>
          </div>
        )}

        {analysisResult && activeTab === 'text' && (
          <div className={clsx(
            'p-4 rounded-lg',
            theme === 'dark' ? 'bg-gray-700' : 'bg-gray-100'
          )}>
            <h3 className="font-medium mb-2">Extracted Text</h3>
            <p className="text-sm opacity-80">
              {analysisResult.text || 'No text detected in the image'}
            </p>
          </div>
        )}

        {analysisResult && activeTab === 'objects' && (
          <div className="space-y-2">
            <h3 className="font-medium mb-2">Detected Objects</h3>
            {analysisResult.objects?.map((obj, idx) => (
              <div
                key={idx}
                className={clsx(
                  'flex items-center justify-between p-2 rounded',
                  theme === 'dark' ? 'bg-gray-700' : 'bg-gray-100'
                )}
              >
                <span className="text-sm">{obj.name}</span>
                <span className="text-xs opacity-60">
                  {Math.round(obj.confidence * 100)}% confidence
                </span>
              </div>
            ))}
          </div>
        )}

        {analysisResult && activeTab === 'metadata' && (
          <div className="space-y-2">
            <h3 className="font-medium mb-2">Image Metadata</h3>
            <div className={clsx(
              'p-3 rounded-lg space-y-1',
              theme === 'dark' ? 'bg-gray-700' : 'bg-gray-100'
            )}>
              <div className="flex justify-between text-sm">
                <span className="opacity-60">Dimensions:</span>
                <span>{analysisResult.metadata?.width} × {analysisResult.metadata?.height}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="opacity-60">Format:</span>
                <span>{analysisResult.metadata?.format}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="opacity-60">Size:</span>
                <span>{(analysisResult.metadata?.size || 0) / 1024} KB</span>
              </div>
            </div>
            {analysisResult.tags && (
              <div>
                <h4 className="text-sm font-medium mb-2">Tags</h4>
                <div className="flex flex-wrap gap-1">
                  {analysisResult.tags.map((tag, idx) => (
                    <span
                      key={idx}
                      className={clsx(
                        'px-2 py-1 text-xs rounded-full',
                        theme === 'dark'
                          ? 'bg-gray-700 text-gray-300'
                          : 'bg-gray-200 text-gray-700'
                      )}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default ImageAnalysis;