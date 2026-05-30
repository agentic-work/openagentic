/**
 * File Attachment Example - Quick Start Guide
 *
 * This is a minimal example showing how to use the FileAttachmentThumbnails component
 * in your own React components.
 */

import React, { useState, useRef } from 'react';
import FileAttachmentThumbnails, { AttachmentFile } from './FileAttachmentThumbnails';

const FileAttachmentExample: React.FC = () => {
  const [attachments, setAttachments] = useState<AttachmentFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Handle file selection
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []);

    const newAttachments: AttachmentFile[] = files.map((file) => {
      // Determine file type
      const extension = file.name.split('.').pop()?.toLowerCase();
      const mimeType = file.type.toLowerCase();

      let fileType: AttachmentFile['type'] = 'other';

      if (mimeType.startsWith('image/')) {
        fileType = 'image';
      } else if (mimeType === 'application/pdf' || extension === 'pdf') {
        fileType = 'pdf';
      } else if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp'].includes(extension || '')) {
        fileType = 'code';
      } else if (['xls', 'xlsx', 'csv'].includes(extension || '')) {
        fileType = 'spreadsheet';
      } else if (extension === 'json') {
        fileType = 'json';
      } else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension || '')) {
        fileType = 'archive';
      } else if (['doc', 'docx', 'txt', 'md'].includes(extension || '')) {
        fileType = 'document';
      }

      // Create preview URL for images
      let preview: string | undefined;
      if (fileType === 'image' && !mimeType.includes('svg')) {
        preview = URL.createObjectURL(file);
      }

      return {
        id: `${file.name}-${Date.now()}`,
        file,
        type: fileType,
        preview
      };
    });

    setAttachments((prev) => [...prev, ...newAttachments]);

    // Reset input
    event.target.value = '';
  };

  // Handle file removal
  const handleRemove = (fileId: string) => {
    const fileToRemove = attachments.find(a => a.id === fileId);

    // Clean up preview URL
    if (fileToRemove?.preview) {
      URL.revokeObjectURL(fileToRemove.preview);
    }

    setAttachments((prev) => prev.filter(a => a.id !== fileId));
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">File Attachment Example</h2>

      {/* File Input Button */}
      <button
        onClick={() => fileInputRef.current?.click()}
        className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg mb-4"
      >
        Choose Files
      </button>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={handleFileSelect}
        className="hidden"
        accept=".txt,.pdf,.doc,.docx,.xls,.xlsx,.csv,.json,.xml,.md,.py,.js,.ts,.jsx,.tsx,.java,.cpp,.c,.h,.cs,.rb,.go,.rs,.php,.swift,.kt,.sql,.png,.jpg,.jpeg,.gif,.webp,.svg"
      />

      {/* Thumbnails Display */}
      <div className="mt-6">
        <FileAttachmentThumbnails
          attachments={attachments}
          onRemove={handleRemove}
        />
      </div>

      {/* File Count */}
      {attachments.length > 0 && (
        <p className="mt-4 text-sm text-gray-600">
          {attachments.length} file(s) attached
        </p>
      )}
    </div>
  );
};

export default FileAttachmentExample;
