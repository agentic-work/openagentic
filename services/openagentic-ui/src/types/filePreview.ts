/* eslint-disable no-restricted-syntax -- File type colors are intentional category indicators */

export interface FileAttachment {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
  uploadedAt: string;
  preview?: {
    thumbnail?: string;
    dimensions?: {
      width: number;
      height: number;
    };
  };
}

export interface SupportedFileType {
  extension: string;
  mimeType: string;
  category: 'image' | 'document' | 'video' | 'audio' | 'code' | 'other';
  previewable: boolean;
  icon: string;
  color: string;
}

export const SUPPORTED_FILE_TYPES: SupportedFileType[] = [
  // Images
  { extension: 'jpg', mimeType: 'image/jpeg', category: 'image', previewable: true, icon: '🖼️', color: '#4ade80' },
  { extension: 'jpeg', mimeType: 'image/jpeg', category: 'image', previewable: true, icon: '🖼️', color: '#4ade80' },
  { extension: 'png', mimeType: 'image/png', category: 'image', previewable: true, icon: '🖼️', color: '#4ade80' },
  { extension: 'gif', mimeType: 'image/gif', category: 'image', previewable: true, icon: '🖼️', color: '#4ade80' },
  { extension: 'webp', mimeType: 'image/webp', category: 'image', previewable: true, icon: '🖼️', color: '#4ade80' },
  { extension: 'svg', mimeType: 'image/svg+xml', category: 'image', previewable: true, icon: '🖼️', color: '#4ade80' },
  
  // Documents
  { extension: 'pdf', mimeType: 'application/pdf', category: 'document', previewable: true, icon: '📄', color: '#ef4444' },
  { extension: 'doc', mimeType: 'application/msword', category: 'document', previewable: true, icon: '📝', color: '#2563eb' },
  { extension: 'docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', category: 'document', previewable: true, icon: '📝', color: '#2563eb' },
  { extension: 'xls', mimeType: 'application/vnd.ms-excel', category: 'document', previewable: true, icon: '📊', color: '#16a34a' },
  { extension: 'xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', category: 'document', previewable: true, icon: '📊', color: '#16a34a' },
  { extension: 'ppt', mimeType: 'application/vnd.ms-powerpoint', category: 'document', previewable: true, icon: '📋', color: '#ea580c' },
  { extension: 'pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', category: 'document', previewable: true, icon: '📋', color: '#ea580c' },
  { extension: 'txt', mimeType: 'text/plain', category: 'document', previewable: true, icon: '📄', color: '#6b7280' },
  { extension: 'rtf', mimeType: 'application/rtf', category: 'document', previewable: true, icon: '📄', color: '#6b7280' },
  
  // Code files
  { extension: 'js', mimeType: 'text/javascript', category: 'code', previewable: true, icon: '⚡', color: '#f59e0b' },
  { extension: 'ts', mimeType: 'text/typescript', category: 'code', previewable: true, icon: '🔷', color: '#3b82f6' },
  { extension: 'jsx', mimeType: 'text/jsx', category: 'code', previewable: true, icon: '⚛️', color: '#06b6d4' },
  { extension: 'tsx', mimeType: 'text/tsx', category: 'code', previewable: true, icon: '⚛️', color: '#06b6d4' },
  { extension: 'css', mimeType: 'text/css', category: 'code', previewable: true, icon: '🎨', color: '#8b5cf6' },
  { extension: 'scss', mimeType: 'text/scss', category: 'code', previewable: true, icon: '🎨', color: '#8b5cf6' },
  { extension: 'html', mimeType: 'text/html', category: 'code', previewable: true, icon: '🌐', color: '#ef4444' },
  { extension: 'json', mimeType: 'application/json', category: 'code', previewable: true, icon: '{}', color: '#16a34a' },
  { extension: 'xml', mimeType: 'text/xml', category: 'code', previewable: true, icon: '📋', color: '#ea580c' },
  { extension: 'md', mimeType: 'text/markdown', category: 'code', previewable: true, icon: '📝', color: '#6b7280' },
  { extension: 'py', mimeType: 'text/x-python', category: 'code', previewable: true, icon: '🐍', color: '#3b82f6' },
  { extension: 'java', mimeType: 'text/x-java-source', category: 'code', previewable: true, icon: '☕', color: '#ea580c' },
  { extension: 'cpp', mimeType: 'text/x-c++src', category: 'code', previewable: true, icon: '⚙️', color: '#6b7280' },
  { extension: 'c', mimeType: 'text/x-csrc', category: 'code', previewable: true, icon: '⚙️', color: '#6b7280' },
  
  // Video
  { extension: 'mp4', mimeType: 'video/mp4', category: 'video', previewable: true, icon: '🎥', color: '#8b5cf6' },
  { extension: 'avi', mimeType: 'video/x-msvideo', category: 'video', previewable: true, icon: '🎥', color: '#8b5cf6' },
  { extension: 'mov', mimeType: 'video/quicktime', category: 'video', previewable: true, icon: '🎥', color: '#8b5cf6' },
  { extension: 'webm', mimeType: 'video/webm', category: 'video', previewable: true, icon: '🎥', color: '#8b5cf6' },
  
  // Audio
  { extension: 'mp3', mimeType: 'audio/mpeg', category: 'audio', previewable: true, icon: '🎵', color: '#ec4899' },
  { extension: 'wav', mimeType: 'audio/wav', category: 'audio', previewable: true, icon: '🎵', color: '#ec4899' },
  { extension: 'ogg', mimeType: 'audio/ogg', category: 'audio', previewable: true, icon: '🎵', color: '#ec4899' },
];

export function getFileTypeInfo(filename: string): SupportedFileType | null {
  const extension = filename.split('.').pop()?.toLowerCase();
  if (!extension) return null;
  
  return SUPPORTED_FILE_TYPES.find(type => type.extension === extension) || null;
}

export function isPreviewable(filename: string): boolean {
  const fileType = getFileTypeInfo(filename);
  return fileType?.previewable || false;
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export interface FilePreviewProps {
  file: FileAttachment;
  onClose?: () => void;
  onDownload?: () => void;
  className?: string;
}