/**
 * File Attachment Thumbnails Demo Component
 *
 * Demonstrates all the features of the FileAttachmentThumbnails component:
 * - Image thumbnails with actual preview
 * - PDF icon with filename
 * - Document icons with filename
 * - Code file icons with filename
 * - Spreadsheet, JSON, archive file icons
 * - Remove button for each attachment
 * - Upload progress indicator
 */

import React, { useState } from 'react';
import FileAttachmentThumbnails, { AttachmentFile } from './FileAttachmentThumbnails';

// Demo component showing all file type variations
const FileAttachmentThumbnailsDemo: React.FC = () => {
  const [demoAttachments, setDemoAttachments] = useState<AttachmentFile[]>([
    {
      id: 'demo-image-1',
      file: new File([''], 'vacation-photo.jpg', { type: 'image/jpeg' }),
      type: 'image',
      preview: 'https://picsum.photos/200/200?random=1'
    },
    {
      id: 'demo-image-2',
      file: new File([''], 'screenshot.png', { type: 'image/png' }),
      type: 'image',
      preview: 'https://picsum.photos/200/200?random=2'
    },
    {
      id: 'demo-pdf-1',
      file: new File([''], 'project-proposal.pdf', { type: 'application/pdf' }),
      type: 'pdf'
    },
    {
      id: 'demo-doc-1',
      file: new File([''], 'meeting-notes.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      type: 'document'
    },
    {
      id: 'demo-code-1',
      file: new File([''], 'app.tsx', { type: 'text/typescript' }),
      type: 'code'
    },
    {
      id: 'demo-code-2',
      file: new File([''], 'main.py', { type: 'text/x-python' }),
      type: 'code'
    },
    {
      id: 'demo-spreadsheet-1',
      file: new File([''], 'budget-2024.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
      type: 'spreadsheet'
    },
    {
      id: 'demo-json-1',
      file: new File([''], 'config.json', { type: 'application/json' }),
      type: 'json'
    },
    {
      id: 'demo-archive-1',
      file: new File([''], 'backup.zip', { type: 'application/zip' }),
      type: 'archive'
    },
    {
      id: 'demo-uploading-1',
      file: new File([''], 'large-video.mp4', { type: 'video/mp4' }),
      type: 'other',
      uploadProgress: 45
    }
  ]);

  const handleRemove = (fileId: string) => {
    setDemoAttachments(prev => prev.filter(file => file.id !== fileId));
  };

  const handleAddSampleFiles = () => {
    const newFiles: AttachmentFile[] = [
      {
        id: `demo-new-${Date.now()}`,
        file: new File([''], 'new-document.txt', { type: 'text/plain' }),
        type: 'document'
      }
    ];
    setDemoAttachments(prev => [...prev, ...newFiles]);
  };

  const handleSimulateUpload = () => {
    const newFile: AttachmentFile = {
      id: `demo-upload-${Date.now()}`,
      file: new File([''], 'uploading-file.pdf', { type: 'application/pdf' }),
      type: 'pdf',
      uploadProgress: 0
    };

    setDemoAttachments(prev => [...prev, newFile]);

    // Simulate upload progress
    let progress = 0;
    const interval = setInterval(() => {
      progress += Math.random() * 20;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        // Remove upload progress when complete
        setTimeout(() => {
          setDemoAttachments(prev =>
            prev.map(file =>
              file.id === newFile.id
                ? { ...file, uploadProgress: undefined }
                : file
            )
          );
        }, 500);
      }

      setDemoAttachments(prev =>
        prev.map(file =>
          file.id === newFile.id
            ? { ...file, uploadProgress: Math.min(progress, 100) }
            : file
        )
      );
    }, 300);
  };

  return (
    <div className="p-8 bg-theme-bg-primary min-h-screen">
      <div className="max-w-4xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-theme-text-primary mb-2">
            File Attachment Thumbnails Demo
          </h1>
          <p className="text-theme-text-secondary">
            Interactive demonstration of the file attachment thumbnail component with various file types
          </p>
        </div>

        {/* Controls */}
        <div className="flex gap-3">
          <button
            onClick={handleAddSampleFiles}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Add Sample File
          </button>
          <button
            onClick={handleSimulateUpload}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
          >
            Simulate Upload
          </button>
          <button
            onClick={() => setDemoAttachments([])}
            className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            Clear All
          </button>
        </div>

        {/* File Count */}
        <div className="px-4 py-3 bg-theme-bg-secondary rounded-lg border border-theme-border-primary">
          <p className="text-sm text-theme-text-secondary">
            <span className="font-semibold text-theme-text-primary">{demoAttachments.length}</span> file(s) attached
          </p>
        </div>

        {/* Thumbnails Display */}
        <div className="p-6 bg-theme-bg-secondary rounded-xl border border-theme-border-primary">
          <h2 className="text-lg font-semibold text-theme-text-primary mb-4">
            Thumbnail Preview
          </h2>
          {demoAttachments.length === 0 ? (
            <p className="text-center text-theme-text-muted py-8">
              No files attached. Click "Add Sample File" to see the thumbnails in action.
            </p>
          ) : (
            <FileAttachmentThumbnails
              attachments={demoAttachments}
              onRemove={handleRemove}
            />
          )}
        </div>

        {/* Feature List */}
        <div className="p-6 bg-theme-bg-secondary rounded-xl border border-theme-border-primary">
          <h2 className="text-lg font-semibold text-theme-text-primary mb-4">
            Features
          </h2>
          <ul className="space-y-2 text-sm text-theme-text-secondary">
            <li className="flex items-start gap-2">
              <span className="text-green-500 font-bold">✓</span>
              <span><strong>Image Thumbnails:</strong> Displays actual image preview with fallback to icon</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 font-bold">✓</span>
              <span><strong>File Type Icons:</strong> Custom icons for PDF, documents, code files, spreadsheets, JSON, archives</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 font-bold">✓</span>
              <span><strong>File Information:</strong> Shows filename, size, and file type badge</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 font-bold">✓</span>
              <span><strong>Remove Button:</strong> Appears on hover with smooth animation</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 font-bold">✓</span>
              <span><strong>Upload Progress:</strong> Animated progress bar for files being uploaded</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 font-bold">✓</span>
              <span><strong>Responsive Layout:</strong> Wraps nicely in multiple rows</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-green-500 font-bold">✓</span>
              <span><strong>Smooth Animations:</strong> Framer Motion for enter/exit animations</span>
            </li>
          </ul>
        </div>

        {/* Supported File Types */}
        <div className="p-6 bg-theme-bg-secondary rounded-xl border border-theme-border-primary">
          <h2 className="text-lg font-semibold text-theme-text-primary mb-4">
            Supported File Types
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <h3 className="font-medium text-theme-text-primary mb-2">Images</h3>
              <p className="text-theme-text-muted">PNG, JPG, JPEG, GIF, WEBP, SVG, BMP, TIFF</p>
            </div>
            <div>
              <h3 className="font-medium text-theme-text-primary mb-2">Documents</h3>
              <p className="text-theme-text-muted">PDF, DOC, DOCX, TXT, MD, RTF, ODT</p>
            </div>
            <div>
              <h3 className="font-medium text-theme-text-primary mb-2">Code Files</h3>
              <p className="text-theme-text-muted">JS, TS, PY, JAVA, CPP, GO, RS, PHP, etc.</p>
            </div>
            <div>
              <h3 className="font-medium text-theme-text-primary mb-2">Spreadsheets</h3>
              <p className="text-theme-text-muted">XLS, XLSX, CSV</p>
            </div>
            <div>
              <h3 className="font-medium text-theme-text-primary mb-2">Data Files</h3>
              <p className="text-theme-text-muted">JSON, XML</p>
            </div>
            <div>
              <h3 className="font-medium text-theme-text-primary mb-2">Archives</h3>
              <p className="text-theme-text-muted">ZIP, RAR, 7Z, TAR, GZ</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FileAttachmentThumbnailsDemo;
