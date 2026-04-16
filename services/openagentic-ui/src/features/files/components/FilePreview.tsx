/**
 * @copyright 2025 Openagentic LLC
 * @license PROPRIETARY
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  X, 
  Download, 
  ExternalLink, 
  Maximize2, 
  Minimize2,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Eye,
  FileText,
  AlertTriangle
} from '@/shared/icons';
import DocViewer, { DocViewerRenderers } from 'react-doc-viewer';
import { FileAttachment, getFileTypeInfo, formatFileSize, type FilePreviewProps } from '@/types/filePreview';

export const FilePreview: React.FC<FilePreviewProps> = ({
  file,
  onClose,
  onDownload,
  className = ''
}) => {
  const [isMaximized, setIsMaximized] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const previewRef = useRef<HTMLDivElement>(null);

  const fileType = getFileTypeInfo(file.name);

  const handleZoomIn = useCallback(() => {
    setZoom(prev => Math.min(prev + 25, 300));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom(prev => Math.max(prev - 25, 25));
  }, []);

  const handleRotate = useCallback(() => {
    setRotation(prev => (prev + 90) % 360);
  }, []);

  const handleDownload = useCallback(() => {
    try {
      const link = document.createElement('a');
      link.href = file.url;
      link.download = file.name;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      onDownload?.();
    } catch (error) {
      console.error('Download failed:', error);
      setError('Failed to download file');
    }
  }, [file, onDownload]);

  const handleOpenExternal = useCallback(() => {
    window.open(file.url, '_blank', 'noopener,noreferrer');
  }, [file.url]);

  const renderPreview = () => {
    if (!fileType) {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <FileText size={64} 
            className="mx-auto mb-4"
            style={{ color: 'var(--color-textMuted)' }} />
            <p style={{ color: 'var(--color-textSecondary)' }}>
              Preview not available for this file type
            </p>
          </div>
        </div>
      );
    }

    // Handle images
    if (fileType.category === 'image') {
      return (
        <div 
          className="flex items-center justify-center h-full overflow-hidden"
          style={{ 
            transform: `scale(${zoom / 100}) rotate(${rotation}deg)`,
            transition: 'transform 0.3s ease'
          }}
        >
          <img
            src={file.url}
            alt={file.name}
            className="max-w-full max-h-full object-contain"
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setIsLoading(false);
              setError('Failed to load image');
            }}
          />
        </div>
      );
    }

    // Handle videos
    if (fileType.category === 'video') {
      return (
        <div className="flex items-center justify-center h-full">
          <video
            src={file.url}
            controls
            className="max-w-full max-h-full"
            onLoadedData={() => setIsLoading(false)}
            onError={() => {
              setIsLoading(false);
              setError('Failed to load video');
            }}
          >
            Your browser does not support the video tag.
          </video>
        </div>
      );
    }

    // Handle audio
    if (fileType.category === 'audio') {
      return (
        <div className="flex items-center justify-center h-full">
          <div className="text-center">
            <div className="text-6xl mb-4">{fileType.icon}</div>
            <h3 
            className="text-lg font-semibold mb-4"
            style={{ color: 'var(--color-text)' }}>
              {file.name}
            </h3>
            <audio
              src={file.url}
              controls
              className="mx-auto"
              onLoadedData={() => setIsLoading(false)}
              onError={() => {
                setIsLoading(false);
                setError('Failed to load audio');
              }}
            >
              Your browser does not support the audio tag.
            </audio>
          </div>
        </div>
      );
    }

    // Handle documents with DocViewer
    if (fileType.category === 'document' || fileType.category === 'code') {
      const docs = [{ uri: file.url, fileName: file.name }];
      
      return (
        <div className="h-full w-full">
          <DocViewer
            documents={docs}
            pluginRenderers={DocViewerRenderers}
            theme={{
              primary: 'var(--color-primary-600)',
              secondary: 'var(--color-neutral-100)',
              tertiary: 'var(--color-neutral-50)',
              text_primary: 'var(--color-text)',
              text_secondary: 'var(--color-text-secondary)',
              text_tertiary: 'var(--color-text-tertiary)',
              disableThemeScrollbar: false
            }}
            style={{
              height: '100%',
              background: 'transparent'
            }}
            config={{
              header: {
                disableHeader: true,
                disableFileName: true,
                retainURLParams: false
              }
            }}
          />
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <div className="text-6xl mb-4">{fileType.icon}</div>
          <h3 
          className="text-lg font-semibold mb-2"
          style={{ color: 'var(--color-text)' }}>
            {file.name}
          </h3>
          <p 
          className="mb-4"
          style={{ color: 'var(--color-textSecondary)' }}>
            {formatFileSize(file.size)}
          </p>
          <button
            onClick={handleDownload}
            
            className="px-4 py-2 bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
            style={{ color: 'var(--color-text)' }}
          >
            Download File
          </button>
        </div>
      </div>
    );
  };

  const showImageControls = fileType?.category === 'image';

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={`fixed inset-0 z-50 flex items-center justify-center ${className}`}
      >
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.85)' }}
        />

        {/* Preview Container */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className={`relative bg-white rounded-lg shadow-2xl overflow-hidden ${
            isMaximized ? 'w-screen h-screen rounded-none' : 'w-11/12 h-5/6 max-w-6xl'
          }`}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          {/* Header */}
          <div 
          className="flex items-center justify-between px-4 py-3 border-b"
          style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{fileType?.icon || '📄'}</span>
              <div>
                <h3 
                className="font-semibold truncate max-w-md"
                style={{ color: 'var(--color-text)' }}>
                  {file.name}
                </h3>
                <p 
                className="text-sm"
                style={{ color: 'var(--color-textSecondary)' }}>
                  {formatFileSize(file.size)} • {fileType?.extension.toUpperCase() || 'Unknown'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {/* Image Controls */}
              {showImageControls && (
                <>
                  <button
                    onClick={handleZoomOut}
                    
                    className="p-2 hover:text-gray-800 :text-gray-100 hover:bg-gray-100 :bg-gray-700 rounded-lg transition-colors"
                    style={{ color: 'var(--color-textSecondary)' }}
                    title="Zoom Out"
                  >
                    <ZoomOut size={16} />
                  </button>
                  
                  <span 
                  className="text-sm min-w-[3rem] text-center"
                  style={{ color: 'var(--color-textSecondary)' }}>
                    {zoom}%
                  </span>
                  
                  <button
                    onClick={handleZoomIn}
                    
                    className="p-2 hover:text-gray-800 :text-gray-100 hover:bg-gray-100 :bg-gray-700 rounded-lg transition-colors"
                    style={{ color: 'var(--color-textSecondary)' }}
                    title="Zoom In"
                  >
                    <ZoomIn size={16} />
                  </button>
                  
                  <button
                    onClick={handleRotate}
                    
                    className="p-2 hover:text-gray-800 :text-gray-100 hover:bg-gray-100 :bg-gray-700 rounded-lg transition-colors"
                    style={{ color: 'var(--color-textSecondary)' }}
                    title="Rotate"
                  >
                    <RotateCw size={16} />
                  </button>
                  
                  <div 
                  className="w-px h-6"
                  style={{ backgroundColor: 'var(--color-surfaceHover)' }} />
                </>
              )}

              <button
                onClick={handleDownload}
                
                className="p-2 hover:text-gray-800 :text-gray-100 hover:bg-gray-100 :bg-gray-700 rounded-lg transition-colors"
                style={{ color: 'var(--color-textSecondary)' }}
                title="Download"
              >
                <Download size={16} />
              </button>

              <button
                onClick={handleOpenExternal}
                
                className="p-2 hover:text-gray-800 :text-gray-100 hover:bg-gray-100 :bg-gray-700 rounded-lg transition-colors"
                style={{ color: 'var(--color-textSecondary)' }}
                title="Open in New Tab"
              >
                <ExternalLink size={16} />
              </button>

              <button
                onClick={() => setIsMaximized(!isMaximized)}
                
                className="p-2 hover:text-gray-800 :text-gray-100 hover:bg-gray-100 :bg-gray-700 rounded-lg transition-colors"
                style={{ color: 'var(--color-textSecondary)' }}
                title={isMaximized ? 'Restore' : 'Maximize'}
              >
                {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>

              <button
                onClick={onClose}
                
                className="p-2 hover:text-gray-800 :text-gray-100 hover:bg-gray-100 :bg-gray-700 rounded-lg transition-colors"
                style={{ color: 'var(--color-textSecondary)' }}
                title="Close"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div 
            ref={previewRef}

            className="relative flex-1 overflow-hidden"
            style={{ backgroundColor: 'var(--color-surface)', height: 'calc(100% - 73px)' }}
          >
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="flex items-center gap-3">
                  <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary-500 border-t-transparent" />
                  <span style={{ color: 'var(--color-textSecondary)' }}>Loading preview...</span>
                </div>
              </div>
            )}

            {error && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                  <h3 
                  className="text-lg font-semibold mb-2"
                  style={{ color: 'var(--color-text)' }}>
                    Preview Error
                  </h3>
                  <p 
                  className="mb-4"
                  style={{ color: 'var(--color-textSecondary)' }}>{error}</p>
                  <button
                    onClick={handleDownload}
                    
                    className="px-4 py-2 bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
                    style={{ color: 'var(--color-text)' }}
                  >
                    Download File Instead
                  </button>
                </div>
              </div>
            )}

            {!error && renderPreview()}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};