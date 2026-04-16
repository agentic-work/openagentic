/**
 * File Management Hook
 * Provides methods for file upload, processing, and management
 */

import { useState, useCallback } from 'react';
import { useAuth } from '@/app/providers/AuthContext';

export interface FileInfo {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  uploadPath?: string;
  extractedText?: string;
  previewUrl?: string;
  metadata?: {
    uploadedAt: string;
    hash: string;
    sha256?: string;
    extracted?: any;
    contentLength?: number;
  };
  uploadStatus: 'pending' | 'uploading' | 'completed' | 'failed';
  createdAt: string;
  updatedAt?: string;
}

export interface FileUploadProgress {
  fileId: string;
  filename: string;
  progress: number;
  status: 'uploading' | 'completed' | 'failed';
}

export interface FileAnalysisInput {
  fileIds: string[];
  analysisType?: 'summary' | 'comparison' | 'aggregate';
}

export const useFiles = () => {
  const { getAuthHeaders } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Map<string, number>>(new Map());

  // List files
  const listFiles = useCallback(async (
    sessionId?: string,
    type?: string,
    limit = 50,
    offset = 0
  ): Promise<{ files: FileInfo[]; total: number }> => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString()
      });
      if (sessionId) params.append('sessionId', sessionId);
      if (type) params.append('type', type);

      const response = await fetch(`/api/files?${params}`, { headers });
      
      if (!response.ok) {
        throw new Error('Failed to fetch files');
      }
      
      return await response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch files';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  // Upload file with progress tracking
  const uploadFile = useCallback(async (
    file: File,
    options?: {
      sessionId?: string;
      title?: string;
      tags?: string[];
      onProgress?: (progress: number) => void;
    }
  ): Promise<FileInfo> => {
    const fileId = crypto.randomUUID();
    setError(null);
    
    try {
      const headers = await getAuthHeaders();
      const formData = new FormData();
      formData.append('file', file);
      if (options?.title) formData.append('title', options.title);
      if (options?.sessionId) formData.append('sessionId', options.sessionId);
      if (options?.tags) formData.append('tags', JSON.stringify(options.tags));

      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        
        // Progress tracking
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const progress = (e.loaded / e.total) * 100;
            setUploadProgress(prev => new Map(prev).set(fileId, progress));
            options?.onProgress?.(progress);
          }
        };

        // Upload complete
        xhr.onload = () => {
          setUploadProgress(prev => {
            const newMap = new Map(prev);
            newMap.delete(fileId);
            return newMap;
          });
          
          if (xhr.status === 200) {
            const response = JSON.parse(xhr.responseText);
            resolve(response);
          } else {
            reject(new Error('Upload failed'));
          }
        };

        // Error handling
        xhr.onerror = () => {
          setUploadProgress(prev => {
            const newMap = new Map(prev);
            newMap.delete(fileId);
            return newMap;
          });
          reject(new Error('Upload failed'));
        };

        // Send request
        xhr.open('POST', '/files/upload');
        Object.entries(headers).forEach(([key, value]) => {
          xhr.setRequestHeader(key, value as string);
        });
        xhr.send(formData);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to upload file';
      setError(message);
      throw err;
    }
  }, [getAuthHeaders]);

  // Upload multiple files
  const uploadFiles = useCallback(async (
    files: File[],
    options?: {
      sessionId?: string;
      onProgress?: (fileId: string, progress: number) => void;
    }
  ): Promise<FileInfo[]> => {
    const results: FileInfo[] = [];
    
    for (const file of files) {
      try {
        const result = await uploadFile(file, {
          ...options,
          onProgress: (progress) => options?.onProgress?.(file.name, progress)
        });
        results.push(result);
      } catch (err) {
        console.error(`Failed to upload ${file.name}:`, err);
      }
    }
    
    return results;
  }, [uploadFile]);

  // Download file
  const downloadFile = useCallback(async (fileId: string): Promise<Blob> => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/files/${fileId}/download`, { headers });
      
      if (!response.ok) {
        throw new Error('Failed to download file');
      }
      
      return await response.blob();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to download file';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  // Delete file
  const deleteFile = useCallback(async (fileId: string): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/files/${fileId}`, {
        method: 'DELETE',
        headers
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete file');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete file';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  // Process file
  const processFile = useCallback(async (
    fileId: string,
    operation: string
  ): Promise<any> => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/files/${fileId}/process`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ operation })
      });
      
      if (!response.ok) {
        throw new Error('Failed to process file');
      }
      
      return await response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to process file';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  // Analyze files
  const analyzeFiles = useCallback(async (
    input: FileAnalysisInput
  ): Promise<any> => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/files/analyze', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(input)
      });
      
      if (!response.ok) {
        throw new Error('Failed to analyze files');
      }
      
      return await response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to analyze files';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  // Get file thumbnail
  const getFileThumbnail = useCallback(async (fileId: string): Promise<string> => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/files/${fileId}/thumbnail`, { headers });
      
      if (!response.ok) {
        throw new Error('Failed to get thumbnail');
      }
      
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get thumbnail';
      setError(message);
      throw err;
    }
  }, [getAuthHeaders]);

  // Extract text from file
  const extractText = useCallback(async (fileId: string): Promise<{ text: string }> => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/files/${fileId}/extract-text`, {
        method: 'POST',
        headers
      });
      
      if (!response.ok) {
        throw new Error('Failed to extract text');
      }
      
      return await response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to extract text';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  return {
    loading,
    error,
    uploadProgress,
    listFiles,
    uploadFile,
    uploadFiles,
    downloadFile,
    deleteFile,
    processFile,
    analyzeFiles,
    getFileThumbnail,
    extractText
  };
};