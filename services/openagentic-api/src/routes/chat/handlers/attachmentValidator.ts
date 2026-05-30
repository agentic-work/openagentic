/**
 * attachmentValidator — pre-flight check for drag-drop chat uploads.
 *
 * Two failure modes the user MUST see explicitly (not silent broken
 * behaviour):
 *  1. File too big → 413 with a readable size + limit message.
 *  2. Unsupported mime → 415 with the supported-list spelled out.
 *
 * Per-file limit: 25 MiB. The total /api/chat/stream body limit is
 * 256 MiB (post-fix #4ab6a0d5) but that is the network ceiling; this
 * is the per-attachment usability ceiling. 25 MiB is generous enough
 * for most PDFs/DOCX/screenshots while keeping LLM token costs
 * reasonable after extraction.
 *
 * Supported mimes match what `extractAttachmentText` + `buildUserMessageContent`
 * (in `routes/chat/pipeline/chat/`) can actually USE — anything else is a
 * silent footgun (the model would receive binary garbage as a data: url).
 */

export const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024; // 25 MiB

const SUPPORTED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

const SUPPORTED_TEXT_MIMES = new Set([
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/javascript',
  'application/typescript',
]);

const SUPPORTED_DOC_MIMES = new Set([
  'application/pdf',
  // .docx (Office Open XML wordprocessingml). .doc (binary OLE) is NOT
  // supported because mammoth can't parse it.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/** Human-readable list shown in 415 errors. Keep it short. */
export const SUPPORTED_TYPES_USER_MSG =
  'PDF, DOCX, images (PNG/JPEG/GIF/WEBP/SVG), and text-based files (TXT, MD, JSON, CSV, XML, YAML, code).';

export interface AttachmentLite {
  originalName?: string;
  mimeType: string;
  /** Decoded byte size. The handler computes this from base64Data length when needed. */
  size?: number;
  base64Data?: string;
}

export type ValidationResult =
  | { ok: true }
  | { ok: false; status: 413 | 415; message: string };

function bytesOf(att: AttachmentLite): number {
  if (typeof att.size === 'number' && att.size > 0) return att.size;
  if (typeof att.base64Data === 'string') {
    // Approximate: base64 inflates by ~4/3. Decoded size ≈ length * 3/4.
    return Math.floor((att.base64Data.length * 3) / 4);
  }
  return 0;
}

function isSupportedMime(mime: string): boolean {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('text/')) return true;
  if (SUPPORTED_IMAGE_MIMES.has(m)) return true;
  if (SUPPORTED_TEXT_MIMES.has(m)) return true;
  if (SUPPORTED_DOC_MIMES.has(m)) return true;
  return false;
}

function fmtMib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

/**
 * Validate a single attachment. Returns ok or a structured error with
 * the HTTP status the route handler should set.
 */
export function validateAttachment(att: AttachmentLite): ValidationResult {
  const name = att.originalName || 'file';
  const bytes = bytesOf(att);
  if (bytes > MAX_ATTACHMENT_SIZE_BYTES) {
    return {
      ok: false,
      status: 413,
      message: `File "${name}" is ${fmtMib(bytes)} which exceeds the ${fmtMib(MAX_ATTACHMENT_SIZE_BYTES)} per-file limit. Please attach a smaller file.`,
    };
  }
  if (!isSupportedMime(att.mimeType)) {
    return {
      ok: false,
      status: 415,
      message: `File "${name}" has unsupported type "${att.mimeType || 'unknown'}". Supported: ${SUPPORTED_TYPES_USER_MSG}`,
    };
  }
  return { ok: true };
}

/**
 * Validate every attachment in a list. Returns the first failure, or
 * `{ok: true}` if all pass. Linear is fine — practical drag-drop sets
 * are <10 files.
 */
export function validateAttachments(
  atts: AttachmentLite[] | undefined,
): ValidationResult {
  if (!atts || atts.length === 0) return { ok: true };
  for (const att of atts) {
    const v = validateAttachment(att);
    if (!v.ok) return v;
  }
  return { ok: true };
}
