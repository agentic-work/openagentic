/**
 * File Attachment Thumbnails Component
 *
 * Displays inline thumbnail previews for attached files in the chat input area.
 * Features:
 * - Image thumbnails with actual preview
 * - PDF icon with filename
 * - Document icons with filename
 * - Code file icons with filename
 * - Remove button for each attachment
 * - Upload progress indicator
 * - Responsive grid layout
 */

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  FileText,
  File,
  FileCode,
  Image as ImageIcon,
  Loader2,
  FileSpreadsheet,
  FileJson,
  FileArchive
} from '@/shared/icons';
import clsx from 'clsx';

export interface AttachmentFile {
  id: string;
  file: File;
  type: 'image' | 'pdf' | 'document' | 'code' | 'spreadsheet' | 'json' | 'archive' | 'other';
  preview?: string;
  uploadProgress?: number;
}

interface FileAttachmentThumbnailsProps {
  attachments: AttachmentFile[];
  onRemove?: (fileId: string) => void;
  className?: string;
}

// File type detector
const getFileType = (file: File): AttachmentFile['type'] => {
  const extension = file.name.split('.').pop()?.toLowerCase();
  const mimeType = file.type.toLowerCase();

  // Images
  if (mimeType.startsWith('image/')) {
    return 'image';
  }

  // PDFs
  if (mimeType === 'application/pdf' || extension === 'pdf') {
    return 'pdf';
  }

  // Code files
  const codeExtensions = ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'hpp', 'cs', 'rb', 'go', 'rs', 'php', 'swift', 'kt', 'r', 'm', 'sql'];
  if (codeExtensions.includes(extension || '')) {
    return 'code';
  }

  // Spreadsheets
  const spreadsheetExtensions = ['xls', 'xlsx', 'csv'];
  if (spreadsheetExtensions.includes(extension || '') || mimeType.includes('spreadsheet')) {
    return 'spreadsheet';
  }

  // JSON
  if (extension === 'json' || mimeType === 'application/json') {
    return 'json';
  }

  // Archives
  const archiveExtensions = ['zip', 'rar', '7z', 'tar', 'gz'];
  if (archiveExtensions.includes(extension || '') || mimeType.includes('zip') || mimeType.includes('compressed')) {
    return 'archive';
  }

  // Documents
  const docExtensions = ['doc', 'docx', 'txt', 'md', 'rtf', 'odt'];
  if (docExtensions.includes(extension || '') || mimeType.includes('document') || mimeType.includes('text')) {
    return 'document';
  }

  return 'other';
};

// File icon component
const FileIcon: React.FC<{ type: AttachmentFile['type'], className?: string }> = ({ type, className }) => {
  const iconClass = className || 'w-5 h-5';

  switch (type) {
    case 'image':
      return <ImageIcon className={clsx(iconClass, 'text-pink-400')} />;
    case 'pdf':
      return (
        <div className={clsx(iconClass, 'text-red-400 font-bold flex items-center justify-center text-[10px]')}>
          PDF
        </div>
      );
    case 'code':
      return <FileCode className={clsx(iconClass, 'text-green-400')} />;
    case 'spreadsheet':
      return <FileSpreadsheet className={clsx(iconClass, 'text-blue-400')} />;
    case 'json':
      return <FileJson className={clsx(iconClass, 'text-yellow-400')} />;
    case 'archive':
      return <FileArchive className={clsx(iconClass, 'text-orange-400')} />;
    case 'document':
      return <FileText className={clsx(iconClass, 'text-blue-400')} />;
    default:
      return <File className={clsx(iconClass, 'text-gray-400')} />;
  }
};

// Format file size
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

const FileAttachmentThumbnails: React.FC<FileAttachmentThumbnailsProps> = ({
  attachments,
  onRemove,
  className
}) => {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className={clsx('flex flex-wrap gap-2', className)}>
      <AnimatePresence mode="popLayout">
        {attachments.map((attachment) => {
          const isUploading = attachment.uploadProgress !== undefined && attachment.uploadProgress < 100;
          const fileType = getFileType(attachment.file);

          return (
            <motion.div
              key={attachment.id}
              layout
              initial={{ opacity: 0, scale: 0.8, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.8, y: -20 }}
              transition={{
                type: "spring",
                stiffness: 400,
                damping: 25,
                layout: { duration: 0.2 }
              }}
              className={clsx(
                'relative group',
                'flex items-center gap-3 px-3 py-2.5',
                'rounded-xl border',
                'bg-theme-bg-secondary hover:bg-theme-bg-tertiary',
                'border-theme-border-primary hover:border-theme-border-hover',
                'transition-all duration-200',
                'min-w-[200px] max-w-[280px]',
                isUploading && 'opacity-70'
              )}
            >
              {/* Thumbnail/Icon Section */}
              <div className="flex-shrink-0">
                {attachment.type === 'image' && attachment.preview ? (
                  <div className="relative w-12 h-12 rounded-lg overflow-hidden shadow-sm bg-theme-bg-tertiary">
                    <img
                      src={attachment.preview}
                      alt={attachment.file.name}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        // Fallback to icon if image fails to load
                        const parent = e.currentTarget.parentElement;
                        if (parent) {
                          parent.innerHTML = '<div class="w-full h-full flex items-center justify-center"><svg class="w-6 h-6 text-pink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg></div>';
                        }
                      }}
                    />
                    {isUploading && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className={clsx(
                    'w-12 h-12 rounded-lg',
                    'flex items-center justify-center',
                    'bg-theme-bg-tertiary',
                    'border border-theme-border-primary'
                  )}>
                    {isUploading ? (
                      <Loader2 className="w-6 h-6 text-theme-accent animate-spin" />
                    ) : (
                      <FileIcon type={fileType} className="w-6 h-6" />
                    )}
                  </div>
                )}
              </div>

              {/* File Info Section */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className={clsx(
                      'text-sm font-medium truncate',
                      'text-theme-text-primary'
                    )}>
                      {attachment.file.name}
                    </div>
                    <div className={clsx(
                      'text-xs mt-0.5',
                      'text-theme-text-muted'
                    )}>
                      {formatFileSize(attachment.file.size)}
                      {fileType !== 'other' && (
                        <span className="ml-2 text-theme-accent">
                          {fileType.toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Remove Button */}
                  {onRemove && !isUploading && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => onRemove(attachment.id)}
                      className={clsx(
                        'opacity-0 group-hover:opacity-100',
                        'transition-opacity duration-200',
                        'p-1 rounded-full',
                        'hover:bg-red-500/20',
                        'text-theme-text-muted hover:text-red-400'
                      )}
                      title="Remove file"
                    >
                      <X size={16} />
                    </motion.button>
                  )}
                </div>

                {/* Upload Progress Bar */}
                {isUploading && (
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-theme-text-muted">Uploading...</span>
                      <span className="text-theme-accent font-medium">
                        {Math.round(attachment.uploadProgress || 0)}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-theme-bg-tertiary rounded-full overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${attachment.uploadProgress || 0}%` }}
                        transition={{ duration: 0.3, ease: "easeOut" }}
                        className="h-full bg-gradient-to-r from-theme-accent to-blue-500 rounded-full"
                      />
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};

export default FileAttachmentThumbnails;
