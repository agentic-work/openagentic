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

import React, { useState, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Upload, 
  Paperclip, 
  X, 
  Plus,
  AlertCircle,
  CheckCircle2,
  FileText
} from '@/shared/icons';
import { FileAttachment as FileAttachmentType, getFileTypeInfo, formatFileSize } from '@/types/filePreview';
import { FileAttachment } from './FileAttachment';

interface FileUploadProps {
  files: FileAttachmentType[];
  onFilesChange: (files: FileAttachmentType[]) => void;
  maxFiles?: number;
  maxFileSize?: number; // in bytes
  acceptedTypes?: string[];
  compact?: boolean;
  className?: string;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  files,
  onFilesChange,
  maxFiles = 10,
  maxFileSize = 50 * 1024 * 1024, // 50MB default
  acceptedTypes,
  compact = false,
  className = ''
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validateFile = (file: File): string | null => {
    if (file.size > maxFileSize) {
      return `File "${file.name}" is too large. Maximum size is ${formatFileSize(maxFileSize)}.`;
    }

    if (acceptedTypes && acceptedTypes.length > 0) {
      const fileExtension = file.name.split('.').pop()?.toLowerCase();
      const isAccepted = acceptedTypes.some(type => {
        if (type.startsWith('.')) {
          return type.slice(1) === fileExtension;
        }
        return file.type.includes(type);
      });

      if (!isAccepted) {
        return `File type "${fileExtension}" is not supported.`;
      }
    }

    return null;
  };

  const processFiles = useCallback(async (fileList: FileList) => {
    const newErrors: string[] = [];
    const validFiles: FileAttachmentType[] = [];

    // Check total file count
    if (files.length + fileList.length > maxFiles) {
      newErrors.push(`Cannot upload more than ${maxFiles} files.`);
      setUploadErrors(newErrors);
      return;
    }

    setIsUploading(true);

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const error = validateFile(file);
      
      if (error) {
        newErrors.push(error);
        continue;
      }

      try {
        // Create object URL for preview
        const url = URL.createObjectURL(file);
        
        // Generate thumbnail for images
        let preview: FileAttachmentType['preview'] | undefined;
        const fileType = getFileTypeInfo(file.name);
        
        if (fileType?.category === 'image') {
          try {
            const thumbnail = await generateImageThumbnail(file);
            const img = new Image();
            await new Promise((resolve) => {
              img.onload = resolve;
              img.src = url;
            });
            
            preview = {
              thumbnail,
              dimensions: {
                width: img.naturalWidth,
                height: img.naturalHeight
              }
            };
          } catch (error) {
            // console.warn('Failed to generate thumbnail:', error);
          }
        }

        const fileAttachment: FileAttachmentType = {
          id: `${Date.now()}-${i}`,
          name: file.name,
          url,
          type: file.type,
          size: file.size,
          uploadedAt: new Date().toISOString(),
          preview
        };

        validFiles.push(fileAttachment);
      } catch (error) {
        newErrors.push(`Failed to process file "${file.name}".`);
      }
    }

    setIsUploading(false);
    setUploadErrors(newErrors);

    if (validFiles.length > 0) {
      onFilesChange([...files, ...validFiles]);
    }
  }, [files, maxFiles, maxFileSize, acceptedTypes, onFilesChange]);

  const generateImageThumbnail = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const img = new Image();

      img.onload = () => {
        // Calculate thumbnail dimensions (max 200x200)
        const maxSize = 200;
        let { width, height } = img;
        
        if (width > height) {
          if (width > maxSize) {
            height = (height * maxSize) / width;
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = (width * maxSize) / height;
            height = maxSize;
          }
        }

        canvas.width = width;
        canvas.height = height;
        
        ctx?.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };

      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const droppedFiles = e.dataTransfer.files;
    if (droppedFiles.length > 0) {
      processFiles(droppedFiles);
    }
  }, [processFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles && selectedFiles.length > 0) {
      processFiles(selectedFiles);
    }
    // Reset input value to allow selecting the same file again
    e.target.value = '';
  }, [processFiles]);

  const handleRemoveFile = useCallback((fileId: string) => {
    const updatedFiles = files.filter(file => file.id !== fileId);
    onFilesChange(updatedFiles);
    
    // Revoke object URL to free memory
    const removedFile = files.find(f => f.id === fileId);
    if (removedFile && removedFile.url.startsWith('blob:')) {
      URL.revokeObjectURL(removedFile.url);
    }
  }, [files, onFilesChange]);

  const openFileDialog = () => {
    fileInputRef.current?.click();
  };

  const clearErrors = () => {
    setUploadErrors([]);
  };

  if (compact) {
    return (
      <div className={`space-y-2 ${className}`}>
        {/* Compact upload button */}
        <div className="flex items-center gap-2">
          <button
            onClick={openFileDialog}
            disabled={files.length >= maxFiles}
            
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg hover:bg-gray-200 :bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)' }}
          >
            <Paperclip size={14} />
            Attach ({files.length}/{maxFiles})
          </button>
          
          {isUploading && (
            <div 
            className="flex items-center gap-2 text-sm"
            style={{ color: 'var(--color-textSecondary)' }}>
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-500 border-t-transparent" />
              Uploading...
            </div>
          )}
        </div>

        {/* File list */}
        {files.length > 0 && (
          <div className="space-y-1">
            {files.map((file) => (
              <FileAttachment
                key={file.id}
                file={file}
                onRemove={() => handleRemoveFile(file.id)}
                showRemove
                compact
              />
            ))}
          </div>
        )}

        {/* Errors */}
        {uploadErrors.length > 0 && (
          <div className="p-2 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start gap-2">
              <AlertCircle size={14} className="text-red-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                {uploadErrors.map((error, index) => (
                  <p key={index} className="text-xs text-red-700">
                    {error}
                  </p>
                ))}
              </div>
              <button
                onClick={clearErrors}
                className="text-red-500 hover:text-red-700 transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          multiple
          onChange={handleFileSelect}
          accept={acceptedTypes?.join(',')}
          className="hidden"
        />
      </div>
    );
  }

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Upload area */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={openFileDialog}
        className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
          isDragOver
            ? 'border-blue-400 bg-blue-50 '
            : 'border-gray-300 hover:border-gray-400 :border-gray-500'
        } ${files.length >= maxFiles ? 'opacity-50 cursor-not-allowed' : ''}`}
      >
        <div className="space-y-4">
          <div className="flex justify-center">
            {isUploading ? (
              <div className="animate-spin rounded-full h-12 w-12 border-2 border-blue-500 border-t-transparent" />
            ) : (
              <Upload size={48} style={{ color: 'var(--color-textMuted)' }} />
            )}
          </div>
          
          <div>
            <h3 
            className="text-lg font-semibold"
            style={{ color: 'var(--color-text)' }}>
              {isUploading ? 'Processing files...' : 'Drop files here or click to upload'}
            </h3>
            <p 
            className="mt-2"
            style={{ color: 'var(--color-textSecondary)' }}>
              {files.length}/{maxFiles} files • Max {formatFileSize(maxFileSize)} each
            </p>
            {acceptedTypes && acceptedTypes.length > 0 && (
              <p 
              className="text-sm mt-1"
              style={{ color: 'var(--color-textMuted)' }}>
                Supported: {acceptedTypes.join(', ')}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* File grid */}
      <AnimatePresence>
        {files.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {files.map((file) => (
              <FileAttachment
                key={file.id}
                file={file}
                onRemove={() => handleRemoveFile(file.id)}
                showRemove
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload errors */}
      <AnimatePresence>
        {uploadErrors.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 bg-red-50 border border-red-200 rounded-lg"
          >
            <div className="flex items-start gap-3">
              <AlertCircle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h4 className="font-semibold text-red-800 mb-1">
                  Upload Errors
                </h4>
                <ul className="space-y-1">
                  {uploadErrors.map((error, index) => (
                    <li key={index} className="text-sm text-red-700">
                      {error}
                    </li>
                  ))}
                </ul>
              </div>
              <button
                onClick={clearErrors}
                className="text-red-500 hover:text-red-700 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileSelect}
        accept={acceptedTypes?.join(',')}
        className="hidden"
      />
    </div>
  );
};