# File Attachment Thumbnails - Visual Guide

## Component Overview

```
┌────────────────────────────────────────────────────────────────────────────┐
│                      File Attachment Thumbnails                             │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌──────────┐ │  │ ┌──────────┐ │  │
│  │ │  [IMG]   │ │  │ │   PDF    │ │  │ │   <//>   │ │  │ │   📊     │ │  │
│  │ │  Preview │ │  │ │  Icon    │ │  │ │   Icon   │ │  │ │  Icon    │ │  │
│  │ └──────────┘ │  │ └──────────┘ │  │ └──────────┘ │  │ └──────────┘ │  │
│  │ photo.jpg    │  │ report.pdf   │  │ app.tsx      │  │ data.xlsx    │  │
│  │ 2.4 MB · IMG │  │ 456 KB · PDF │  │ 12 KB · CODE │  │ 1.2 MB · XLS │  │
│  │         [x]  │  │         [x]  │  │         [x]  │  │         [x]  │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                                              │
└────────────────────────────────────────────────────────────────────────────┘
```

## Thumbnail Card Anatomy

```
┌─────────────────────────────────────┐
│  ┌────────┐  Filename.ext      [x]  │  ← Hover shows remove button
│  │        │  123 KB · TYPE          │  ← File size and type badge
│  │ THUMB  │  ▓▓▓▓▓▓▓░░░ 75%        │  ← Upload progress (optional)
│  │        │                          │
│  └────────┘                          │
│   64x64px                            │
└─────────────────────────────────────┘
     Thumbnail                File Info
```

## File Type Icons

### Images
```
┌──────────┐
│          │
│   🖼️    │  Purple icon
│  Image   │  Shows actual thumbnail
│          │
└──────────┘
Types: PNG, JPG, GIF, WEBP, SVG, BMP, TIFF
```

### PDFs
```
┌──────────┐
│          │
│   PDF    │  Red badge
│  Icon    │  Shows "PDF" text
│          │
└──────────┘
Type: PDF
```

### Code Files
```
┌──────────┐
│          │
│  <//>    │  Green icon
│  Code    │  Shows code symbol
│          │
└──────────┘
Types: JS, TS, PY, JAVA, CPP, GO, RS, PHP, SQL
```

### Documents
```
┌──────────┐
│          │
│   📝     │  Blue icon
│  Doc     │  Shows document icon
│          │
└──────────┘
Types: DOC, DOCX, TXT, MD, RTF, ODT
```

### Spreadsheets
```
┌──────────┐
│          │
│   📊     │  Blue icon
│  Sheet   │  Shows table icon
│          │
└──────────┘
Types: XLS, XLSX, CSV
```

### JSON Files
```
┌──────────┐
│          │
│   { }    │  Yellow icon
│  JSON    │  Shows braces
│          │
└──────────┘
Type: JSON
```

### Archives
```
┌──────────┐
│          │
│   📦     │  Orange icon
│  Archive │  Shows box icon
│          │
└──────────┘
Types: ZIP, RAR, 7Z, TAR, GZ
```

### Other Files
```
┌──────────┐
│          │
│   📁     │  Gray icon
│  File    │  Shows generic icon
│          │
└──────────┘
Type: Unknown
```

## States

### Normal State
```
┌──────────────────────┐
│ ┌────┐              │
│ │[📄]│ document.pdf │  ← Normal appearance
│ │    │ 456 KB · PDF │  ← No remove button visible
│ └────┘              │
└──────────────────────┘
```

### Hover State
```
┌──────────────────────┐
│ ┌────┐              │
│ │[📄]│ document.pdf [x] ← Remove button appears
│ │    │ 456 KB · PDF │    ← Lighter background
│ └────┘              │
└──────────────────────┘
```

### Uploading State
```
┌──────────────────────┐
│ ┌────┐              │
│ │ 🔄 │ video.mp4    │  ← Spinner on thumbnail
│ │    │ Uploading... │  ← "Uploading..." text
│ └────┘ ▓▓▓▓░░░ 45% │  ← Progress bar
└──────────────────────┘
```

### Image Preview State
```
┌──────────────────────┐
│ ┌────┐              │
│ │████│ photo.jpg    │  ← Shows actual image
│ │████│ 2.4 MB · IMG │  ← Image preview visible
│ └────┘              │
└──────────────────────┘
```

## Animations

### Enter Animation
```
Timeline: 0ms → 300ms

  0ms     100ms    200ms    300ms
   ↓        ↓        ↓        ↓
  [ ]     [  ]    [   ]    [    ]
  ↑        ↑        ↑        ↑
Scale:   0.8      0.9      0.95     1.0
Opacity:  0%      30%      70%     100%
Y-pos:   +20      +10      +5        0
```

### Exit Animation
```
Timeline: 0ms → 300ms

  0ms     100ms    200ms    300ms
   ↓        ↓        ↓        ↓
  [    ]   [   ]    [  ]     [ ]
  ↑        ↑        ↑        ↑
Scale:   1.0      0.95     0.9      0.8
Opacity: 100%      70%      30%       0%
Y-pos:    0       -5       -10      -20
```

### Hover Animation
```
Button Scale: 1.0 → 1.1 (100ms spring)
Button Opacity: 0 → 1 (200ms fade)
Card Background: base → lighter (200ms)
```

### Progress Bar Animation
```
Width: 0% ──────────▓▓▓▓▓▓▓▓▓▓──────────> 100%
       ↑                                     ↑
     Start                                 End
     (300ms ease-out per update)
```

## Responsive Layout

### Desktop (> 768px)
```
┌─────────────────────────────────────────────────────────┐
│  [Thumb] [Thumb] [Thumb] [Thumb] [Thumb]               │
│  [Thumb] [Thumb] [Thumb]                                │
└─────────────────────────────────────────────────────────┘
Multiple thumbnails per row, wraps naturally
```

### Tablet (768px - 1024px)
```
┌──────────────────────────────────────┐
│  [Thumb] [Thumb] [Thumb]             │
│  [Thumb] [Thumb]                     │
└──────────────────────────────────────┘
Fewer thumbnails per row
```

### Mobile (< 768px)
```
┌────────────────────┐
│  [Thumb] [Thumb]   │
│  [Thumb] [Thumb]   │
│  [Thumb]           │
└────────────────────┘
1-2 thumbnails per row
```

## Color Scheme

### File Type Colors
```
Images:       Purple  #A855F7  (purple-400)
PDFs:         Red     #EF4444  (red-400)
Code:         Green   #34D399  (green-400)
Spreadsheets: Blue    #60A5FA  (blue-400)
JSON:         Yellow  #FBBF24  (yellow-400)
Archives:     Orange  #FB923C  (orange-400)
Documents:    Blue    #60A5FA  (blue-400)
Other:        Gray    #9CA3AF  (gray-400)
```

### Background Colors
```
Card Normal:     theme-bg-secondary
Card Hover:      theme-bg-tertiary
Thumbnail BG:    theme-bg-tertiary
Border:          theme-border-primary
Border Hover:    theme-border-hover
```

### Text Colors
```
Filename:        theme-text-primary
File Size:       theme-text-muted
File Type Badge: theme-accent
Progress Text:   theme-text-muted
Progress %:      theme-accent
```

## Usage Flow

```
1. User clicks "+" button
   ↓
2. File picker opens
   ↓
3. User selects file(s)
   ↓
4. Files processed
   • Type detected
   • Preview created (images)
   • Metadata extracted
   ↓
5. Thumbnails appear
   • Fade in animation
   • Scale from 0.8 to 1.0
   ↓
6. User hovers
   • Remove button appears
   • Background lightens
   ↓
7. User clicks remove
   • Fade out animation
   • Scale to 0.8
   • Slide down 20px
   ↓
8. Thumbnail removed
   • Memory cleaned up
   • Preview URL revoked
```

## Integration Points

```
ChatContainer.tsx
    ↓
    Creates File objects
    ↓
    Detects file types
    ↓
    Generates preview URLs (images)
    ↓
    ↓
ChatInputBar.tsx
    ↓
    Receives attachments prop
    ↓
    Passes to FileAttachmentThumbnails
    ↓
    ↓
FileAttachmentThumbnails.tsx
    ↓
    Renders thumbnails
    ↓
    Handles remove action
    ↓
    Manages animations
```

## API Quick Reference

```typescript
// Component Usage
<FileAttachmentThumbnails
  attachments={[
    {
      id: 'unique-id',
      file: File,
      type: 'image' | 'pdf' | 'document' | 'code' | 'spreadsheet' | 'json' | 'archive' | 'other',
      preview?: 'blob:url',
      uploadProgress?: 45  // 0-100
    }
  ]}
  onRemove={(fileId: string) => {
    // Handle file removal
  }}
  className="custom-class"  // Optional
/>
```

## Size Reference

```
Thumbnail:    64 x 64 px
Card Min:     200 px width
Card Max:     280 px width
Card Height:  Auto (approx 80-100px)
Gap:          8 px between cards
Padding:      12 px inside card
Border:       1 px solid
Border Radius: 12 px
```

## Z-Index Layers

```
Layer 5: Remove button (appears on top)
Layer 4: Upload progress overlay
Layer 3: Image preview
Layer 2: Icon container
Layer 1: Card background
```

## Performance Notes

```
✓ Images use createObjectURL (efficient)
✓ Preview URLs cleaned up on unmount
✓ Animations hardware-accelerated
✓ React keys prevent re-renders
✓ Thumbnail size optimized (64x64)
✓ Lazy image loading
✓ Efficient file type detection
```

## Accessibility Features

```
✓ Semantic HTML structure
✓ ARIA labels on buttons
✓ Keyboard navigation support
✓ Screen reader friendly
✓ Color contrast compliant
✓ Focus indicators
✓ Alt text on images
```

---

This visual guide provides a comprehensive overview of the file attachment thumbnails component design, states, animations, and integration points.
