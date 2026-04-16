/**
 * useFileAttachments - Hook for managing file attachments in chat
 * Handles file selection, preview URLs, validation, and cleanup
 */

import { useState, useCallback, useRef, useEffect } from 'react';

// Supported file types
const SUPPORTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const SUPPORTED_DOCUMENT_TYPES = ['application/pdf', 'text/plain', 'text/markdown'];
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_FILES = 5;

export interface FileWithPreview extends File {
  previewUrl?: string;
}

export interface UseFileAttachmentsOptions {
  maxFiles?: number;
  maxFileSize?: number;
  allowedTypes?: string[];
  onError?: (error: string) => void;
}

export const useFileAttachments = (options: UseFileAttachmentsOptions = {}) => {
  const {
    maxFiles = MAX_FILES,
    maxFileSize = MAX_FILE_SIZE,
    allowedTypes = [...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_DOCUMENT_TYPES],
    onError
  } = options;

  const [selectedFiles, setSelectedFiles] = useState<FileWithPreview[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      selectedFiles.forEach(file => {
        if (file.previewUrl) {
          URL.revokeObjectURL(file.previewUrl);
        }
      });
    };
  }, []);

  // Validate a single file
  const validateFile = useCallback((file: File): string | null => {
    // Check file size
    if (file.size > maxFileSize) {
      return `File "${file.name}" exceeds maximum size of ${Math.round(maxFileSize / 1024 / 1024)}MB`;
    }

    // Check file type
    if (allowedTypes.length > 0 && !allowedTypes.includes(file.type)) {
      return `File type "${file.type}" is not supported`;
    }

    return null;
  }, [maxFileSize, allowedTypes]);

  // Create preview URL for image files
  const createPreviewUrl = useCallback((file: File): string | undefined => {
    if (file.type.startsWith('image/') && !file.type.includes('svg')) {
      return URL.createObjectURL(file);
    }
    return undefined;
  }, []);

  // Add files
  const addFiles = useCallback((files: File[]) => {
    const validFiles: FileWithPreview[] = [];
    const errors: string[] = [];

    // Check total file count
    const totalCount = selectedFiles.length + files.length;
    if (totalCount > maxFiles) {
      errors.push(`Maximum ${maxFiles} files allowed. You have ${selectedFiles.length} and tried to add ${files.length}.`);
      files = files.slice(0, maxFiles - selectedFiles.length);
    }

    // Validate each file
    files.forEach(file => {
      const error = validateFile(file);
      if (error) {
        errors.push(error);
      } else {
        // Create preview URL for images
        const previewUrl = createPreviewUrl(file);
        const fileWithPreview: FileWithPreview = Object.assign(file, { previewUrl });
        validFiles.push(fileWithPreview);
      }
    });

    // Report errors
    errors.forEach(error => {
      console.warn('[useFileAttachments]', error);
      onError?.(error);
    });

    // Add valid files
    if (validFiles.length > 0) {
      setSelectedFiles(prev => [...prev, ...validFiles]);
    }

    return { added: validFiles.length, errors };
  }, [selectedFiles.length, maxFiles, validateFile, createPreviewUrl, onError]);

  // Remove file by index
  const removeFile = useCallback((index: number) => {
    setSelectedFiles(prev => {
      const file = prev[index];
      if (file?.previewUrl) {
        URL.revokeObjectURL(file.previewUrl);
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // Remove file by name
  const removeFileByName = useCallback((name: string) => {
    setSelectedFiles(prev => {
      const file = prev.find(f => f.name === name);
      if (file?.previewUrl) {
        URL.revokeObjectURL(file.previewUrl);
      }
      return prev.filter(f => f.name !== name);
    });
  }, []);

  // Clear all files
  const clearFiles = useCallback(() => {
    selectedFiles.forEach(file => {
      if (file.previewUrl) {
        URL.revokeObjectURL(file.previewUrl);
      }
    });
    setSelectedFiles([]);
  }, [selectedFiles]);

  // Handle file input change
  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    addFiles(files);
    // Reset input to allow selecting same file again
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [addFiles]);

  // Trigger file input click
  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  // Handle drag and drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const files = Array.from(e.dataTransfer.files);
    addFiles(files);
  }, [addFiles]);

  // Convert files to base64 for API
  const convertToBase64 = useCallback(async (): Promise<Array<{
    name: string;
    type: string;
    content: string;
  }>> => {
    return Promise.all(
      selectedFiles.map(async (file) => {
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });
        return {
          name: file.name,
          type: file.type,
          content: base64.split(',')[1] // Remove data:image/jpeg;base64, prefix
        };
      })
    );
  }, [selectedFiles]);

  // Check if file type is image
  const isImageFile = useCallback((file: File) => {
    return file.type.startsWith('image/');
  }, []);

  return {
    // State
    selectedFiles,
    fileInputRef,
    hasFiles: selectedFiles.length > 0,
    fileCount: selectedFiles.length,

    // Actions
    addFiles,
    removeFile,
    removeFileByName,
    clearFiles,
    openFilePicker,

    // Event handlers
    handleFileInputChange,
    handleDrop,

    // Utilities
    convertToBase64,
    validateFile,
    isImageFile,

    // Constants (for UI display)
    maxFiles,
    maxFileSize,
    allowedTypes
  };
};

export default useFileAttachments;
