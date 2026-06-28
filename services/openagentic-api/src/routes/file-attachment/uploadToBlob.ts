// Pure planning logic for POST /api/files/upload.
//
// Validates a multipart upload (mime allow-list + size cap), computes the
// MinIO blob key + a sha256 for dedup, and returns a fileId the caller can
// use as the DB primary key. Intentionally has NO side effects — no MinIO
// put, no DB write — so the guardrails are trivial to unit test and so the
// Fastify handler stays thin.
//
// The blob key pattern matches BlobStorageService.generateKey() (used for
// AI-generated images) so "my uploads" and "my generations" coexist under
// the same YYYY/MM/<userId>/... scheme across both buckets.

import crypto from 'crypto';

export const DEFAULT_MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB — matches Fastify bodyLimit + UI nginx

export const DEFAULT_ALLOWED_MIME_TYPES: readonly string[] = [
  // Text
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/xml',
  'application/json',
  // Images
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  // Documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const;

// MIME → extension fallback used when we need to persist an extension in the
// blob key and the original filename's extension disagrees with / is missing.
// Keep sparse — we only need the types in the allow-list above.
const MIME_TO_EXT: Record<string, string> = {
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'text/html': 'html',
  'text/xml': 'xml',
  'application/json': 'json',
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

export interface UploadPlanInput {
  userId: string;
  originalFilename: string;
  mimeType: string;
  buffer: Buffer;
  allowedMimeTypes?: readonly string[];
  maxBytes?: number;
  /** Override the clock — useful for deterministic tests. */
  now?: () => number;
}

export interface UploadPlan {
  fileId: string;
  blobKey: string;
  sha256: string;
  size: number;
  mimeType: string;
  extension: string;
}

function sanitizeUserId(userId: string): string {
  // Strip anything that could let a user id escape its prefix in the bucket.
  // Drops "/", "..", control chars; keeps alnum + -_ and clamps to 50 chars
  // (same rule BlobStorageService.generateKey uses, so keys look consistent).
  return userId.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
}

function extensionFor(filename: string, mimeType: string): string {
  // Prefer the filename's extension (case-insensitive, lowercased for key
  // stability). Fall back to the MIME-table when the filename lacks one —
  // e.g. a FormData blob posted without a name field.
  const dot = filename.lastIndexOf('.');
  if (dot >= 0 && dot < filename.length - 1) {
    const fromName = filename.slice(dot + 1).toLowerCase();
    // Basic validation: extensions should be short and alnum-only.
    if (/^[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  }
  return MIME_TO_EXT[mimeType] ?? 'bin';
}

export function planUpload(input: UploadPlanInput): UploadPlan {
  const allowed = input.allowedMimeTypes ?? DEFAULT_ALLOWED_MIME_TYPES;
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_UPLOAD_BYTES;
  const now = input.now ?? Date.now;

  if (!allowed.includes(input.mimeType)) {
    throw new Error(`Mime type not allowed: ${input.mimeType}`);
  }
  if (input.buffer.length > maxBytes) {
    throw new Error(`File size ${input.buffer.length} exceeds max ${maxBytes} bytes`);
  }

  const ts = now();
  const rand = crypto.randomBytes(4).toString('hex'); // 8 hex chars
  const fileId = `file_${ts}_${rand}`;
  const ext = extensionFor(input.originalFilename, input.mimeType);

  const safeUser = sanitizeUserId(input.userId);
  const date = new Date(ts);
  const yearMonth = `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}`;
  const blobKey = `${yearMonth}/${safeUser}/${fileId}.${ext}`;

  const sha256 = crypto.createHash('sha256').update(input.buffer).digest('hex');

  return {
    fileId,
    blobKey,
    sha256,
    size: input.buffer.length,
    mimeType: input.mimeType,
    extension: ext,
  };
}
