# File Attachment Thumbnails - Key Code Snippets

## 1. Component Interface

```typescript
// Core interface for file attachments
interface AttachmentFile {
  id: string;                    // Unique identifier
  file: File;                    // The actual File object
  type: 'image' | 'pdf' | 'document' | 'code' | 'spreadsheet' | 'json' | 'archive' | 'other';
  preview?: string;              // Preview URL for images (blob:...)
  uploadProgress?: number;       // Upload progress 0-100
}

// Component props
interface FileAttachmentThumbnailsProps {
  attachments: AttachmentFile[];
  onRemove?: (fileId: string) => void;
  className?: string;
}
```

## 2. File Type Detection

```typescript
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
  const codeExtensions = ['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'cs', 'rb', 'go', 'rs', 'php', 'swift', 'kt', 'sql'];
  if (codeExtensions.includes(extension || '')) {
    return 'code';
  }

  // Spreadsheets
  if (['xls', 'xlsx', 'csv'].includes(extension || '') || mimeType.includes('spreadsheet')) {
    return 'spreadsheet';
  }

  // JSON
  if (extension === 'json' || mimeType === 'application/json') {
    return 'json';
  }

  // Archives
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension || '') || mimeType.includes('zip') || mimeType.includes('compressed')) {
    return 'archive';
  }

  // Documents
  if (['doc', 'docx', 'txt', 'md', 'rtf', 'odt'].includes(extension || '') || mimeType.includes('document') || mimeType.includes('text')) {
    return 'document';
  }

  return 'other';
};
```

## 3. File Type Icons

```typescript
const FileIcon: React.FC<{ type: AttachmentFile['type'], className?: string }> = ({ type, className }) => {
  const iconClass = className || 'w-5 h-5';

  switch (type) {
    case 'image':
      return <ImageIcon className={clsx(iconClass, 'text-purple-400')} />;
    case 'pdf':
      return <div className={clsx(iconClass, 'text-red-400 font-bold text-[10px]')}>PDF</div>;
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
```

## 4. Main Component Structure

```typescript
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
              {/* Thumbnail section */}
              <div className="flex-shrink-0">
                {attachment.type === 'image' && attachment.preview ? (
                  <div className="relative w-12 h-12 rounded-lg overflow-hidden shadow-sm bg-theme-bg-tertiary">
                    <img
                      src={attachment.preview}
                      alt={attachment.file.name}
                      className="w-full h-full object-cover"
                    />
                    {isUploading && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <Loader2 className="w-5 h-5 text-white animate-spin" />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="w-12 h-12 rounded-lg flex items-center justify-center bg-theme-bg-tertiary border border-theme-border-primary">
                    {isUploading ? (
                      <Loader2 className="w-6 h-6 text-theme-accent animate-spin" />
                    ) : (
                      <FileIcon type={fileType} className="w-6 h-6" />
                    )}
                  </div>
                )}
              </div>

              {/* File info section */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate text-theme-text-primary">
                      {attachment.file.name}
                    </div>
                    <div className="text-xs mt-0.5 text-theme-text-muted">
                      {formatFileSize(attachment.file.size)}
                      {fileType !== 'other' && (
                        <span className="ml-2 text-theme-accent">
                          {fileType.toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Remove button */}
                  {onRemove && !isUploading && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0 }}
                      animate={{ opacity: 1, scale: 1 }}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => onRemove(attachment.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 rounded-full hover:bg-red-500/20 text-theme-text-muted hover:text-red-400"
                    >
                      <X size={16} />
                    </motion.button>
                  )}
                </div>

                {/* Upload progress bar */}
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
                        className="h-full bg-gradient-to-r from-theme-accent to-purple-500 rounded-full"
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
```

## 5. Integration in ChatInputBar

```typescript
// In ChatInputBar.tsx
import FileAttachmentThumbnails from './FileAttachmentThumbnails';

// Update interface
interface AttachmentFile {
  id: string;
  file: File;
  type: 'image' | 'pdf' | 'document' | 'code' | 'spreadsheet' | 'json' | 'archive' | 'other';
  preview?: string;
  uploadProgress?: number;
}

// In component render
<AnimatePresence>
  {attachments.length > 0 && (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="mb-3"
    >
      <FileAttachmentThumbnails
        attachments={attachments}
        onRemove={onFileRemove}
      />
    </motion.div>
  )}
</AnimatePresence>
```

## 6. Integration in ChatContainer

```typescript
// In ChatContainer.tsx
attachments={selectedFiles.map(file => {
  // Determine file type for proper icon display
  const extension = file.name.split('.').pop()?.toLowerCase();
  const mimeType = file.type.toLowerCase();

  let fileType: 'image' | 'pdf' | 'document' | 'code' | 'spreadsheet' | 'json' | 'archive' | 'other' = 'other';

  if (mimeType.startsWith('image/')) {
    fileType = 'image';
  } else if (mimeType === 'application/pdf' || extension === 'pdf') {
    fileType = 'pdf';
  } else if (['js', 'jsx', 'ts', 'tsx', 'py', 'java', 'cpp', 'c', 'h', 'cs', 'rb', 'go', 'rs', 'php', 'swift', 'kt', 'sql'].includes(extension || '')) {
    fileType = 'code';
  } else if (['xls', 'xlsx', 'csv'].includes(extension || '') || mimeType.includes('spreadsheet')) {
    fileType = 'spreadsheet';
  } else if (extension === 'json' || mimeType === 'application/json') {
    fileType = 'json';
  } else if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension || '') || mimeType.includes('zip') || mimeType.includes('compressed')) {
    fileType = 'archive';
  } else if (['doc', 'docx', 'txt', 'md', 'rtf', 'odt'].includes(extension || '') || mimeType.includes('document') || mimeType.includes('text')) {
    fileType = 'document';
  }

  return {
    id: file.name,
    file,
    type: fileType,
    preview: (file as any).previewUrl
  };
})}
```

## 7. File Handling Example

```typescript
// Handle file selection
const handleFileSelect = (files: File[]) => {
  const filesWithPreviews = files.map(file => {
    if (file.type.startsWith('image/') && !file.type.includes('svg')) {
      // Create a preview URL for the image
      const previewUrl = URL.createObjectURL(file);
      // Store the preview URL on the file object
      (file as any).previewUrl = previewUrl;
    }
    return file;
  });
  setSelectedFiles([...selectedFiles, ...filesWithPreviews]);
};

// Handle file removal
const handleFileRemove = (fileId: string) => {
  // Clean up preview URLs when removing files
  const fileToRemove = selectedFiles.find(f => f.name === fileId);
  if (fileToRemove && (fileToRemove as any).previewUrl) {
    URL.revokeObjectURL((fileToRemove as any).previewUrl);
  }
  setSelectedFiles(selectedFiles.filter(f => f.name !== fileId));
};
```

## 8. Upload Progress Simulation

```typescript
// Simulate upload progress for demo/testing
const simulateUpload = (fileId: string) => {
  let progress = 0;
  const interval = setInterval(() => {
    progress += Math.random() * 20;
    if (progress >= 100) {
      progress = 100;
      clearInterval(interval);
      // Remove progress indicator when complete
      setTimeout(() => {
        setAttachments(prev =>
          prev.map(file =>
            file.id === fileId
              ? { ...file, uploadProgress: undefined }
              : file
          )
        );
      }, 500);
    }

    setAttachments(prev =>
      prev.map(file =>
        file.id === fileId
          ? { ...file, uploadProgress: Math.min(progress, 100) }
          : file
      )
    );
  }, 300);
};
```

## 9. File Size Formatting

```typescript
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

// Examples:
// 1024 → "1 KB"
// 1536 → "1.5 KB"
// 2097152 → "2 MB"
// 5368709120 → "5 GB"
```

## 10. Animation Configuration

```typescript
// Framer Motion animation settings
const animations = {
  // Enter animation
  initial: {
    opacity: 0,
    scale: 0.8,
    y: 20
  },

  // Normal state
  animate: {
    opacity: 1,
    scale: 1,
    y: 0
  },

  // Exit animation
  exit: {
    opacity: 0,
    scale: 0.8,
    y: -20
  },

  // Transition
  transition: {
    type: "spring",
    stiffness: 400,
    damping: 25,
    layout: { duration: 0.2 }
  }
};

// Button hover animation
const buttonHover = {
  scale: 1.1,
  transition: { type: "spring", stiffness: 400, damping: 10 }
};

// Button tap animation
const buttonTap = {
  scale: 0.9
};
```

## 11. Theme-Aware Styling

```typescript
// Using CSS variables for theme support
const themeStyles = {
  card: {
    background: 'var(--color-bg-secondary)',
    backgroundHover: 'var(--color-bg-tertiary)',
    border: 'var(--color-border-primary)',
    borderHover: 'var(--color-border-hover)',
  },
  text: {
    primary: 'var(--color-text-primary)',
    secondary: 'var(--color-text-secondary)',
    muted: 'var(--color-text-muted)',
  },
  accent: 'var(--color-accent)',
};
```

## 12. Accessibility Features

```typescript
// Accessibility attributes
<button
  onClick={() => onRemove(attachment.id)}
  aria-label={`Remove ${attachment.file.name}`}
  title="Remove file"
  role="button"
>
  <X size={16} />
</button>

<img
  src={attachment.preview}
  alt={attachment.file.name}
  role="img"
/>
```

---

These key code snippets provide the essential implementation details for the file attachment thumbnails component.
