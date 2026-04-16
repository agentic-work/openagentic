/**
 * Enhanced File Manager Component
 * Advanced file management with content extraction, processing, and analysis
 * Features: Multi-file upload, PDF/Word extraction, duplicate detection, batch operations
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Folder,
  Upload,
  Download,
  Trash2,
  Search,
  Filter,
  FileText,
  FileImage,
  FileCode,
  FileSpreadsheet,
  FileArchive,
  File,
  Eye,
  Copy,
  RefreshCw,
  MoreVertical,
  ChevronRight,
  Grid,
  List,
  CheckSquare,
  Square,
  AlertCircle,
  Loader2,
  X,
  FileCheck,
  FileX,
  FileWarning,
  HardDrive,
  Zap,
  FileJson,
  Hash,
  Calendar,
  Clock,
  Database
} from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { formatDistanceToNow, format } from 'date-fns';
import { apiEndpoint } from '@/utils/api';

interface FileInfo {
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

interface FileManagerProps {
  sessionId?: string;
  allowMultiple?: boolean;
  maxFileSize?: number;
  acceptedTypes?: string[];
  onFileSelect?: (file: FileInfo) => void;
  embedded?: boolean;
}

export const FileManager: React.FC<FileManagerProps> = ({
  sessionId,
  allowMultiple = true,
  maxFileSize = 10 * 1024 * 1024, // 10MB default
  acceptedTypes,
  onFileSelect,
  embedded = false
}) => {
  const { getAuthHeaders } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null);
  const [uploadProgress, setUploadProgress] = useState<Map<string, number>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [filterType, setFilterType] = useState<string>('all');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // File type icons
  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return FileImage;
    if (mimeType.startsWith('text/') || mimeType.includes('json')) return FileText;
    if (mimeType.includes('pdf')) return FileText;
    if (mimeType.includes('word') || mimeType.includes('document')) return FileText;
    if (mimeType.includes('sheet') || mimeType.includes('excel')) return FileSpreadsheet;
    if (mimeType.includes('zip') || mimeType.includes('archive')) return FileArchive;
    if (mimeType.includes('code') || mimeType.includes('javascript') || mimeType.includes('python')) return FileCode;
    return File;
  };

  // Format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  // Fetch files
  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams();
      if (sessionId) params.append('sessionId', sessionId);
      if (filterType !== 'all') params.append('type', filterType);
      
      const response = await fetch(apiEndpoint(`/files?${params}`), { headers });
      
      if (response.ok) {
        const data = await response.json();
        setFiles(data.files || []);
      } else {
        throw new Error('Failed to fetch files');
      }
    } catch (err) {
      setError('Failed to load files');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders, sessionId, filterType]);

  // Upload files
  const uploadFiles = async (filesToUpload: File[]) => {
    setUploading(true);
    setError(null);
    const headers = await getAuthHeaders();
    
    for (const file of filesToUpload) {
      const fileId = crypto.randomUUID();
      
      // Check file size
      if (file.size > maxFileSize) {
        setError(`File ${file.name} exceeds size limit (${formatFileSize(maxFileSize)})`);
        continue;
      }

      // Check file type
      if (acceptedTypes && !acceptedTypes.some(type => file.type.match(type))) {
        setError(`File type ${file.type} not accepted`);
        continue;
      }

      try {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', file.name);
        if (sessionId) formData.append('sessionId', sessionId);

        // Track upload progress
        setUploadProgress(prev => new Map(prev).set(fileId, 0));

        const xhr = new XMLHttpRequest();
        
        // Progress tracking
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const progress = (e.loaded / e.total) * 100;
            setUploadProgress(prev => new Map(prev).set(fileId, progress));
          }
        };

        // Upload complete
        xhr.onload = () => {
          if (xhr.status === 200) {
            const response = JSON.parse(xhr.responseText);
            setFiles(prev => [...prev, response]);
            setUploadProgress(prev => {
              const newMap = new Map(prev);
              newMap.delete(fileId);
              return newMap;
            });
          } else {
            throw new Error('Upload failed');
          }
        };

        // Error handling
        xhr.onerror = () => {
          setError(`Failed to upload ${file.name}`);
          setUploadProgress(prev => {
            const newMap = new Map(prev);
            newMap.delete(fileId);
            return newMap;
          });
        };

        // Send request
        xhr.open('POST', '/files/upload');
        Object.entries(headers).forEach(([key, value]) => {
          xhr.setRequestHeader(key, value as string);
        });
        xhr.send(formData);

      } catch (err) {
        console.error(`Failed to upload ${file.name}:`, err);
        setError(`Failed to upload ${file.name}`);
      }
    }
    
    setUploading(false);
    setShowUploadModal(false);
    fetchFiles();
  };

  // Handle file selection
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length > 0) {
      uploadFiles(selectedFiles);
    }
  };

  // Handle drag and drop
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length > 0) {
      uploadFiles(droppedFiles);
    }
  };

  // Download file
  const downloadFile = async (file: FileInfo) => {
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(apiEndpoint(`/files/${file.id}/download`), { headers });
      
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.originalName || file.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      setError('Failed to download file');
      console.error(err);
    }
  };

  // Delete files
  const deleteFiles = async (fileIds: string[]) => {
    if (!confirm(`Delete ${fileIds.length} file(s)?`)) return;
    
    try {
      const headers = await getAuthHeaders();
      
      for (const id of fileIds) {
        await fetch(apiEndpoint(`/files/${id}`), {
          method: 'DELETE',
          headers
        });
      }
      
      setFiles(prev => prev.filter(f => !fileIds.includes(f.id)));
      setSelectedFiles(new Set());
    } catch (err) {
      setError('Failed to delete files');
      console.error(err);
    }
  };

  // Process file
  const processFile = async (fileId: string, operation: string) => {
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(apiEndpoint(`/files/${fileId}/process`), {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ operation })
      });
      
      if (response.ok) {
        const result = await response.json();
        setAnalysisResult(result);
        fetchFiles(); // Refresh to get updated metadata
      }
    } catch (err) {
      setError('Failed to process file');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Batch analyze files
  const analyzeFiles = async () => {
    if (selectedFiles.size === 0) return;
    
    setLoading(true);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch(apiEndpoint('/files/analyze'), {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fileIds: Array.from(selectedFiles),
          analysisType: 'aggregate'
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        setAnalysisResult(result.analysis);
      }
    } catch (err) {
      setError('Failed to analyze files');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Toggle file selection
  const toggleFileSelection = (fileId: string) => {
    setSelectedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  };

  // Select all files
  const selectAllFiles = () => {
    if (selectedFiles.size === files.length) {
      setSelectedFiles(new Set());
    } else {
      setSelectedFiles(new Set(files.map(f => f.id)));
    }
  };

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  return (
    <div className={`file-manager ${embedded ? 'h-full' : 'min-h-screen'} bg-gray-900 text-white flex flex-col`}>
      {/* Header */}
      <div 
      className="border-b p-4"
      style={{ borderColor: 'var(--color-borderHover)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Folder className="w-6 h-6 text-blue-400" />
            <h2 className="text-xl font-semibold">File Manager</h2>
            <span 
            className="text-sm"
            style={{ color: 'var(--color-textMuted)' }}>({files.length} files)</span>
          </div>
          
          <div className="flex items-center gap-2">
            {selectedFiles.size > 0 && (
              <>
                <span 
                className="text-sm"
                style={{ color: 'var(--color-textMuted)' }}>{selectedFiles.size} selected</span>
                <button
                  onClick={analyzeFiles}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 rounded flex items-center gap-1"
                >
                  <Zap className="w-4 h-4" />
                  Analyze
                </button>
                <button
                  onClick={() => deleteFiles(Array.from(selectedFiles))}
                  className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded flex items-center gap-1"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </>
            )}
            
            <button
              onClick={() => setShowUploadModal(true)}
              className="px-3 py-1 bg-green-600 hover:bg-green-700 rounded flex items-center gap-1"
            >
              <Upload className="w-4 h-4" />
              Upload
            </button>
            
            <button
              onClick={fetchFiles}
              className="p-1 hover:bg-gray-800 rounded"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-4 mt-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search 
            className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4"
            style={{ color: 'var(--color-textMuted)' }} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search files..."
              
              className="w-full pl-10 pr-4 py-2 border rounded"
              style={{ backgroundColor: 'var(--color-background)', borderColor: 'var(--color-borderHover)' }}
            />
          </div>

          {/* Filter */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            
            className="px-3 py-2 border rounded"
            style={{ backgroundColor: 'var(--color-background)', borderColor: 'var(--color-borderHover)' }}
          >
            <option value="all">All Files</option>
            <option value="image">Images</option>
            <option value="document">Documents</option>
            <option value="text">Text Files</option>
            <option value="archive">Archives</option>
          </select>

          {/* View Mode */}
          <div 
          className="flex items-center rounded"
          style={{ backgroundColor: 'var(--color-background)' }}>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 ${viewMode === 'list' ? 'bg-gray-700' : ''} rounded-l`}
            >
              <List className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 ${viewMode === 'grid' ? 'bg-gray-700' : ''} rounded-r`}
            >
              <Grid className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* File List/Grid */}
        <div className="flex-1 overflow-auto p-4">
          {loading && files.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
            </div>
          ) : files.length === 0 ? (
            <div 
            className="flex flex-col items-center justify-center py-12"
            style={{ color: 'var(--color-textMuted)' }}>
              <Folder className="w-16 h-16 mb-4 opacity-50" />
              <p>No files uploaded yet</p>
              <button
                onClick={() => setShowUploadModal(true)}
                className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
              >
                Upload Files
              </button>
            </div>
          ) : (
            <>
              {/* Select All */}
              {viewMode === 'list' && (
                <div 
                className="flex items-center gap-2 mb-2 pb-2 border-b"
                style={{ borderColor: 'var(--color-borderHover)' }}>
                  <button
                    onClick={selectAllFiles}
                    className="p-1 hover:bg-gray-800 rounded"
                  >
                    {selectedFiles.size === files.length ? (
                      <CheckSquare className="w-4 h-4" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                  <span 
                  className="text-sm"
                  style={{ color: 'var(--color-textMuted)' }}>Select All</span>
                </div>
              )}

              {/* File Display */}
              <div className={viewMode === 'grid' ? 'grid grid-cols-4 gap-4' : 'space-y-2'}>
                {files
                  .filter(file => 
                    searchQuery === '' || 
                    file.filename.toLowerCase().includes(searchQuery.toLowerCase())
                  )
                  .map((file) => {
                    const Icon = getFileIcon(file.mimeType);
                    const isSelected = selectedFiles.has(file.id);
                    
                    return viewMode === 'list' ? (
                      // List View
                      <div
                        key={file.id}
                        className={`flex items-center p-3 rounded-lg hover:bg-gray-800 cursor-pointer ${
                          isSelected ? 'bg-gray-800 ring-2 ring-blue-500' : ''
                        } ${selectedFile?.id === file.id ? 'bg-gray-700' : ''}`}
                        onClick={() => setSelectedFile(file)}
                      >
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleFileSelection(file.id);
                          }}
                          className="mr-3"
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-blue-400" />
                          ) : (
                            <Square 
                            className="w-4 h-4"
                            style={{ color: 'var(--color-textSecondary)' }} />
                          )}
                        </button>
                        
                        <Icon 
                        className="w-5 h-5 mr-3"
                        style={{ color: 'var(--color-textMuted)' }} />
                        
                        <div className="flex-1">
                          <div className="font-medium text-sm">{file.filename}</div>
                          <div 
                          className="text-xs"
                          style={{ color: 'var(--color-textSecondary)' }}>
                            {formatFileSize(file.size)} • {formatDistanceToNow(new Date(file.createdAt), { addSuffix: true })}
                          </div>
                        </div>

                        {file.extractedText && (
                          <span title="Content extracted">
                            <FileCheck className="w-4 h-4 text-green-400 mr-2" />
                          </span>
                        )}
                        
                        {file.metadata?.sha256 && (
                          <span title="Verified">
                            <Hash className="w-4 h-4 text-blue-400 mr-2" />
                          </span>
                        )}

                        <div className="flex items-center gap-1">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadFile(file);
                            }}
                            className="p-1 hover:bg-gray-700 rounded"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          
                          {onFileSelect && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onFileSelect(file);
                              }}
                              className="p-1 hover:bg-gray-700 rounded"
                            >
                              <ChevronRight className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ) : (
                      // Grid View
                      <div
                        key={file.id}
                        className={`bg-gray-800 rounded-lg p-4 hover:ring-2 hover:ring-blue-500 cursor-pointer ${
                          isSelected ? 'ring-2 ring-blue-500' : ''
                        }`}
                        onClick={() => setSelectedFile(file)}
                      >
                        <div className="flex items-center justify-between mb-3">
                          <Icon 
                          className="w-8 h-8"
                          style={{ color: 'var(--color-textMuted)' }} />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleFileSelection(file.id);
                            }}
                          >
                            {isSelected ? (
                              <CheckSquare className="w-4 h-4 text-blue-400" />
                            ) : (
                              <Square 
                              className="w-4 h-4"
                              style={{ color: 'var(--color-textSecondary)' }} />
                            )}
                          </button>
                        </div>
                        
                        {file.previewUrl && file.mimeType.startsWith('image/') && (
                          <img 
                            src={file.previewUrl} 
                            alt={file.filename}
                            className="w-full h-32 object-cover rounded mb-3"
                          />
                        )}
                        
                        <div className="text-sm font-medium truncate" title={file.filename}>
                          {file.filename}
                        </div>
                        <div 
                        className="text-xs mt-1"
                        style={{ color: 'var(--color-textSecondary)' }}>
                          {formatFileSize(file.size)}
                        </div>
                      </div>
                    );
                  })}
              </div>

              {/* Upload Progress */}
              {uploadProgress.size > 0 && (
                <div 
                className="fixed bottom-4 right-4 rounded-lg p-4 shadow-lg"
                style={{ backgroundColor: 'var(--color-background)' }}>
                  <h4 className="text-sm font-medium mb-2">Uploading...</h4>
                  {Array.from(uploadProgress.entries()).map(([id, progress]) => (
                    <div key={id} className="mb-2">
                      <div 
                      className="w-48 rounded-full h-2"
                      style={{ backgroundColor: 'var(--color-background)' }}>
                        <div 
                          className="bg-blue-600 h-2 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* File Details Panel */}
        {selectedFile && (
          <div 
          className="w-96 border-l p-4 overflow-auto"
          style={{ borderColor: 'var(--color-borderHover)' }}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-medium">File Details</h3>
              <button
                onClick={() => setSelectedFile(null)}
                className="p-1 hover:bg-gray-800 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Preview */}
            {selectedFile.previewUrl && selectedFile.mimeType.startsWith('image/') && (
              <img 
                src={selectedFile.previewUrl} 
                alt={selectedFile.filename}
                className="w-full rounded mb-4"
              />
            )}

            {/* File Info */}
            <div className="space-y-3">
              <div>
                <label 
                className="text-xs"
                style={{ color: 'var(--color-textMuted)' }}>Filename</label>
                <p className="text-sm">{selectedFile.filename}</p>
              </div>
              
              <div>
                <label 
                className="text-xs"
                style={{ color: 'var(--color-textMuted)' }}>Type</label>
                <p className="text-sm">{selectedFile.mimeType}</p>
              </div>
              
              <div>
                <label 
                className="text-xs"
                style={{ color: 'var(--color-textMuted)' }}>Size</label>
                <p className="text-sm">{formatFileSize(selectedFile.size)}</p>
              </div>
              
              <div>
                <label 
                className="text-xs"
                style={{ color: 'var(--color-textMuted)' }}>Uploaded</label>
                <p className="text-sm">
                  {format(new Date(selectedFile.createdAt), 'PPpp')}
                </p>
              </div>

              {selectedFile.metadata?.hash && (
                <div>
                  <label 
                  className="text-xs"
                  style={{ color: 'var(--color-textMuted)' }}>MD5 Hash</label>
                  <p className="text-xs font-mono break-all">{selectedFile.metadata.hash}</p>
                </div>
              )}

              {selectedFile.metadata?.sha256 && (
                <div>
                  <label 
                  className="text-xs"
                  style={{ color: 'var(--color-textMuted)' }}>SHA256 Hash</label>
                  <p className="text-xs font-mono break-all">{selectedFile.metadata.sha256}</p>
                </div>
              )}

              {/* Extracted Content */}
              {selectedFile.extractedText && (
                <div>
                  <label 
                  className="text-xs"
                  style={{ color: 'var(--color-textMuted)' }}>Extracted Content</label>
                  <div 
                  className="mt-1 p-2 rounded text-xs max-h-48 overflow-auto"
                  style={{ backgroundColor: 'var(--color-background)' }}>
                    <pre className="whitespace-pre-wrap">{selectedFile.extractedText}</pre>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="pt-4 space-y-2">
                <button
                  onClick={() => downloadFile(selectedFile)}
                  className="w-full py-2 bg-blue-600 hover:bg-blue-700 rounded flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Download
                </button>
                
                {selectedFile.mimeType.startsWith('text/') && (
                  <button
                    onClick={() => processFile(selectedFile.id, 'extract-text')}
                    
                    className="w-full py-2 hover:bg-gray-600 rounded flex items-center justify-center gap-2"
                    style={{ backgroundColor: 'var(--color-background)' }}
                  >
                    <FileText className="w-4 h-4" />
                    Extract Text
                  </button>
                )}
                
                {onFileSelect && (
                  <button
                    onClick={() => onFileSelect(selectedFile)}
                    className="w-full py-2 bg-green-600 hover:bg-green-700 rounded flex items-center justify-center gap-2"
                  >
                    <ChevronRight className="w-4 h-4" />
                    Select for Chat
                  </button>
                )}
                
                <button
                  onClick={() => deleteFiles([selectedFile.id])}
                  className="w-full py-2 bg-red-600 hover:bg-red-700 rounded flex items-center justify-center gap-2"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Upload Modal */}
      {showUploadModal && (
        <div 
        className="fixed inset-0 bg-opacity-50 flex items-center justify-center z-50 p-4"
        style={{ backgroundColor: 'var(--color-background)' }}>
          <div 
          className="rounded-lg w-full max-w-2xl"
          style={{ backgroundColor: 'var(--color-background)' }}>
            <div 
            className="flex items-center justify-between p-4 border-b"
            style={{ borderColor: 'var(--color-borderHover)' }}>
              <h3 className="text-lg font-medium">Upload Files</h3>
              <button
                onClick={() => setShowUploadModal(false)}
                className="p-1 hover:bg-gray-700 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="p-6">
              <div
                onDragEnter={handleDrag}
                onDragLeave={handleDrag}
                onDragOver={handleDrag}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                  dragActive ? 'border-blue-500 bg-blue-500 bg-opacity-10' : 'border-gray-600'
                }`}
              >
                <Upload 
                className="w-16 h-16 mx-auto mb-4"
                style={{ color: 'var(--color-textMuted)' }} />
                <p className="text-lg mb-2">Drag and drop files here</p>
                <p 
                className="text-sm mb-4"
                style={{ color: 'var(--color-textMuted)' }}>or</p>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded"
                >
                  Browse Files
                </button>
                
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple={allowMultiple}
                  accept={acceptedTypes?.join(',')}
                  onChange={handleFileSelect}
                  className="hidden"
                />
                
                <p 
                className="text-xs mt-4"
                style={{ color: 'var(--color-textSecondary)' }}>
                  Max file size: {formatFileSize(maxFileSize)}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Analysis Results Modal */}
      {analysisResult && (
        <div 
        className="fixed inset-0 bg-opacity-50 flex items-center justify-center z-50 p-4"
        style={{ backgroundColor: 'var(--color-background)' }}>
          <div 
          className="rounded-lg w-full max-w-4xl max-h-[80vh] overflow-auto"
          style={{ backgroundColor: 'var(--color-background)' }}>
            <div 
            className="sticky top-0 flex items-center justify-between p-4 border-b"
            style={{ backgroundColor: 'var(--color-background)', borderColor: 'var(--color-borderHover)' }}>
              <h3 className="text-lg font-medium">Analysis Results</h3>
              <button
                onClick={() => setAnalysisResult(null)}
                className="p-1 hover:bg-gray-700 rounded"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            
            <div className="p-6">
              <pre 
              className="p-4 rounded overflow-auto"
              style={{ backgroundColor: 'var(--color-background)' }}>
                {JSON.stringify(analysisResult, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Error Toast */}
      {error && (
        <div 
        className="fixed bottom-4 left-4 bg-red-600 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2"
        style={{ color: 'var(--color-text)' }}>
          <AlertCircle className="w-4 h-4" />
          {error}
        </div>
      )}
    </div>
  );
};