/**
 * Client-side attachment validator.
 *
 * Mirrors the server-side gate at
 * services/openagentic-api/src/routes/chat/handlers/attachmentValidator.ts.
 * The server is authoritative — this exists so the user gets an instant,
 * specific error in the UI instead of a silent NDJSON error frame after
 * upload. Keep the rules in sync with the server validator.
 */

export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25 MiB

const SUPPORTED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
];

const SUPPORTED_DOCUMENT_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
];

const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'json', 'csv', 'html', 'xml', 'yaml', 'yml',
]);

const SUPPORTED_LIST_HUMAN =
  'PDF, DOCX, images (PNG/JPEG/GIF/WEBP/SVG), and text-based files (TXT, MD, JSON, CSV, XML, YAML)';

export type ValidateAttachmentResult =
  | { ok: true }
  | { ok: false; message: string };

export function validateAttachment(file: File): ValidateAttachmentResult {
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    const fileMb = (file.size / 1024 / 1024).toFixed(1);
    const maxMb = (MAX_ATTACHMENT_SIZE_BYTES / 1024 / 1024).toFixed(0);
    return {
      ok: false,
      message: `File "${file.name}" is ${fileMb} MiB which exceeds the ${maxMb} MiB per-file limit. Please attach a smaller file.`,
    };
  }

  const t = (file.type || '').toLowerCase();
  const ext = (file.name.split('.').pop() ?? '').toLowerCase();

  const isImage = SUPPORTED_IMAGE_TYPES.includes(t);
  const isDoc = SUPPORTED_DOCUMENT_TYPES.includes(t);
  const looksLikeText = t.startsWith('text/') || (t === '' && TEXT_EXT.has(ext));

  if (isImage || isDoc || looksLikeText) {
    return { ok: true };
  }

  return {
    ok: false,
    message: `File "${file.name}" has unsupported type "${file.type || 'unknown'}". Supported: ${SUPPORTED_LIST_HUMAN}.`,
  };
}
