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

import React, { useState } from 'react';
import { X, Download, ExternalLink } from '@/shared/icons';

interface ImageViewerProps {
  src: string;
  alt: string;
  onClose?: () => void;
  title?: string;
}

const ImageViewer: React.FC<ImageViewerProps> = ({ src, alt, onClose, title }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const handleDownload = async () => {
    try {
      const response = await fetch(src);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = title || `image-${Date.now()}.png`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download image:', error);
    }
  };

  const handleOpenExternal = () => {
    window.open(src, '_blank');
  };

  return (
    <div className="image-viewer">
      <div className="relative group">
        <img
          src={src}
          alt={alt}
          className="w-full h-auto rounded-lg shadow-lg"
          onLoad={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setError(true);
          }}
          style={{ display: loading ? 'none' : 'block' }}
        />
        
        {loading && (
          <div 
          className="w-full h-48 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: 'var(--color-surface)' }}>
            <span style={{ color: 'var(--color-textSecondary)' }}>Loading...</span>
          </div>
        )}
        
        {error && (
          <div 
          className="w-full h-48 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: 'var(--color-surface)' }}>
            <span className="text-red-500">Failed to load image</span>
          </div>
        )}

        {/* Overlay buttons */}
        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
          <button
            onClick={handleDownload}
            
            className="p-1.5 hover:bg-black/70 rounded transition-colors"
            style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}
            title="Download image"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            onClick={handleOpenExternal}
            
            className="p-1.5 hover:bg-black/70 rounded transition-colors"
            style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}
            title="Open in new tab"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
          {onClose && (
            <button
              onClick={onClose}
              
              className="p-1.5 hover:bg-black/70 rounded transition-colors"
              style={{ backgroundColor: 'var(--color-background)', color: 'var(--color-text)' }}
              title="Close"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImageViewer;