import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Download, 
  Eye, 
  ExternalLink, 
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Code,
  Trash2
} from '@/shared/icons';
import { FileAttachment as FileAttachmentType, getFileTypeInfo, formatFileSize, isPreviewable } from '@/types/filePreview';
import { FilePreview } from './FilePreview';

interface FileAttachmentProps {
  file: FileAttachmentType;
  onRemove?: () => void;
  onDownload?: () => void;
  showRemove?: boolean;
  compact?: boolean;
  className?: string;
}

export const FileAttachment: React.FC<FileAttachmentProps> = ({
  file,
  onRemove,
  onDownload,
  showRemove = false,
  compact = false,
  className = ''
}) => {
  const [showPreview, setShowPreview] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const fileType = getFileTypeInfo(file.name);
  const canPreview = isPreviewable(file.name);

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
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
    }
  };

  const handlePreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (canPreview) {
      setShowPreview(true);
    }
  };

  const handleOpenExternal = (e: React.MouseEvent) => {
    e.stopPropagation();
    window.open(file.url, '_blank', 'noopener,noreferrer');
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove?.();
  };

  const getCategoryIcon = () => {
    if (!fileType) return <FileText size={compact ? 16 : 20} />;
    
    switch (fileType.category) {
      case 'image':
        return <ImageIcon size={compact ? 16 : 20} />;
      case 'video':
        return <Film size={compact ? 16 : 20} />;
      case 'audio':
        return <Music size={compact ? 16 : 20} />;
      case 'code':
        return <Code size={compact ? 16 : 20} />;
      default:
        return <FileText size={compact ? 16 : 20} />;
    }
  };

  if (compact) {
    return (
      <>
        <motion.div
          whileHover={{ scale: 1.02 }}
          className={`flex items-center gap-2 p-2 bg-[var(--color-surface)] rounded-lg border border-[var(--color-border)] hover:border-gray-300 :border-gray-600 transition-all cursor-pointer ${className}`}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          onClick={canPreview ? handlePreview : handleDownload}
        >
          <div 
            className="flex-shrink-0 p-1 rounded"
            style={{ backgroundColor: `${fileType?.color}20`, color: fileType?.color }}
          >
            {getCategoryIcon()}
          </div>
          
          <div className="flex-1 min-w-0">
            <p 
            className="text-sm font-medium truncate"
            style={{ color: 'var(--color-text)' }}>
              {file.name}
            </p>
            <p 
            className="text-xs"
            style={{ color: 'var(--color-textSecondary)' }}>
              {formatFileSize(file.size)}
            </p>
          </div>

          {isHovered && (
            <div className="flex items-center gap-1">
              {canPreview && (
                <button
                  onClick={handlePreview}
                  
                  className="p-1 hover:text-gray-700 :text-gray-300 transition-colors"
                  style={{ color: 'var(--color-textSecondary)' }}
                  title="Preview"
                >
                  <Eye size={12} />
                </button>
              )}
              
              <button
                onClick={handleDownload}
                
                className="p-1 hover:text-gray-700 :text-gray-300 transition-colors"
                style={{ color: 'var(--color-textSecondary)' }}
                title="Download"
              >
                <Download size={12} />
              </button>

              {showRemove && (
                <button
                  onClick={handleRemove}
                  className="p-1 text-red-500 hover:text-red-700 transition-colors"
                  title="Remove"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          )}
        </motion.div>

        {showPreview && (
          <FilePreview
            file={file}
            onClose={() => setShowPreview(false)}
            onDownload={() => {
              onDownload?.();
              setShowPreview(false);
            }}
          />
        )}
      </>
    );
  }

  // Full size attachment card
  return (
    <>
      <motion.div
        whileHover={{ scale: 1.02 }}
        className={`relative p-4 bg-[var(--color-surface)] rounded-xl border border-[var(--color-border)] shadow-sm hover:shadow-md transition-all cursor-pointer group ${className}`}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={canPreview ? handlePreview : handleDownload}
      >
        {/* Preview thumbnail for images */}
        {fileType?.category === 'image' && file.preview?.thumbnail && (
          <div 
          className="mb-3 rounded-lg overflow-hidden"
          style={{ backgroundColor: 'var(--color-surface)' }}>
            <img
              src={file.preview.thumbnail}
              alt={file.name}
              className="w-full h-32 object-cover"
            />
          </div>
        )}

        {/* File icon and info */}
        <div className="flex items-start gap-3">
          <div 
            className="flex-shrink-0 p-3 rounded-lg"
            style={{ backgroundColor: `${fileType?.color}20`, color: fileType?.color }}
          >
            <span className="text-2xl">{fileType?.icon || '📄'}</span>
          </div>
          
          <div className="flex-1 min-w-0">
            <h4 
            className="text-sm font-semibold truncate"
            style={{ color: 'var(--color-text)' }}>
              {file.name}
            </h4>
            <p 
            className="text-xs mt-1"
            style={{ color: 'var(--color-textSecondary)' }}>
              {formatFileSize(file.size)} • {fileType?.extension.toUpperCase() || 'Unknown'}
            </p>
            {file.uploadedAt && (
              <p 
              className="text-xs mt-1"
              style={{ color: 'var(--color-textMuted)' }}>
                Uploaded {new Date(file.uploadedAt).toLocaleDateString()}
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className={`flex items-center gap-1 transition-opacity ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
            {canPreview && (
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                onClick={handlePreview}
                
                className="p-2 hover:text-blue-600 hover:bg-blue-50 :bg-blue-900/20 rounded-lg transition-colors"
                style={{ color: 'var(--color-textSecondary)' }}
                title="Preview"
              >
                <Eye size={16} />
              </motion.button>
            )}
            
            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleDownload}
              
              className="p-2 hover:text-green-600 hover:bg-green-50 :bg-green-900/20 rounded-lg transition-colors"
              style={{ color: 'var(--color-textSecondary)' }}
              title="Download"
            >
              <Download size={16} />
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleOpenExternal}
              
              className="p-2 hover:text-purple-600 hover:bg-purple-50 :bg-purple-900/20 rounded-lg transition-colors"
              style={{ color: 'var(--color-textSecondary)' }}
              title="Open in New Tab"
            >
              <ExternalLink size={16} />
            </motion.button>

            {showRemove && (
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleRemove}
                
                className="p-2 hover:text-red-600 hover:bg-red-50 :bg-red-900/20 rounded-lg transition-colors"
                style={{ color: 'var(--color-textSecondary)' }}
                title="Remove"
              >
                <Trash2 size={16} />
              </motion.button>
            )}
          </div>
        </div>

        {/* Preview indicator */}
        {canPreview && (
          <div className="absolute top-3 right-3">
            <div className="px-2 py-1 bg-blue-100 text-blue-600 text-xs rounded-full flex items-center gap-1">
              <Eye size={10} />
              Preview
            </div>
          </div>
        )}
      </motion.div>

      {showPreview && (
        <FilePreview
          file={file}
          onClose={() => setShowPreview(false)}
          onDownload={() => {
            onDownload?.();
            setShowPreview(false);
          }}
        />
      )}
    </>
  );
};