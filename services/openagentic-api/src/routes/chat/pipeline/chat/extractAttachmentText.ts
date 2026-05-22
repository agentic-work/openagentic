/**
 * extractAttachmentText — pull readable text out of non-image drag-drop
 * attachments so the LLM can reason over PDF/DOCX/text uploads.
 *
 * `buildUserMessageContent` in this directory uses this helper for
 * non-image attachments. Image attachments are embedded as `image_url`
 * blocks directly; PDF/DOCX/text/JSON are transcribed to text and injected
 * into the user message so any chat model — vision or not — can answer
 * questions about the file.
 *
 * Live evidence prompting this helper: dev 2026-05-08 — image
 * attachments worked end-to-end, but dropping a PDF/DOCX left the
 * model with only the user prompt + a useless `data:` url for a binary
 * the model has no decoder for.
 *
 * Contract:
 *   - text/*, application/json, application/xml, application/yaml →
 *     utf-8 decode (json gets pretty-printed for the model)
 *   - application/pdf → pdf-parse v2 PDFParse.getText().text
 *   - .docx (Office Open XML wordprocessingml) → mammoth.extractRawText
 *   - everything else → null (caller can render a "[unsupported file:
 *     name (mime)]" placeholder so the model at least knows it was
 *     dropped)
 *
 * The extraction pass is best-effort: any throw inside a parser is
 * caught and converted to null. The caller distinguishes "extraction
 * declined" (mime type we don't support) from "extraction crashed" via
 * the boolean second-return.
 */

const TEXT_MIME_PREFIXES = ['text/'];
const TEXT_MIME_EXACT = new Set([
  'application/json',
  'application/xml',
  'application/yaml',
  'application/x-yaml',
  'application/javascript',
  'application/typescript',
]);
const PDF_MIME = 'application/pdf';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface AttachmentForExtraction {
  /** base64-encoded payload of the file. */
  base64Data?: string;
  /** mime type as sniffed by the upload handler. */
  mimeType: string;
  /** original filename — used for utf-8 decoding fallback hints. */
  originalName?: string;
}

/**
 * Extract a textual representation of `att` suitable for inlining into
 * the user message. Returns `null` when the mime is unsupported OR when
 * extraction crashed (caller should render a placeholder either way).
 */
export async function extractAttachmentText(
  att: AttachmentForExtraction,
): Promise<string | null> {
  if (!att.base64Data) return null;
  const mime = (att.mimeType || '').toLowerCase();

  // Plain text family — the model can read this directly. Decode utf-8.
  if (
    TEXT_MIME_PREFIXES.some(p => mime.startsWith(p)) ||
    TEXT_MIME_EXACT.has(mime)
  ) {
    try {
      const buf = Buffer.from(att.base64Data, 'base64');
      const raw = buf.toString('utf-8');
      if (mime === 'application/json') {
        try {
          return JSON.stringify(JSON.parse(raw), null, 2);
        } catch {
          return raw;
        }
      }
      return raw;
    } catch {
      return null;
    }
  }

  // PDF — use pdf-parse v2's PDFParse class. Lazy-import so the costly
  // pdfjs-dist worker only loads when an actual PDF is dropped.
  if (mime === PDF_MIME) {
    try {
      const { PDFParse } = await import('pdf-parse');
      const buf = Buffer.from(att.base64Data, 'base64');
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      const result = await parser.getText();
      await parser.destroy();
      // PDFParse v2 returns either {text: string} or {pages: PageTextResult[]}
      // depending on params; the no-arg form fills `text`.
      return (result as any)?.text ?? null;
    } catch {
      return null;
    }
  }

  // DOCX — mammoth can't handle .doc (binary OLE) but handles .docx fine.
  if (mime === DOCX_MIME) {
    try {
      const mammoth = (await import('mammoth')).default ?? (await import('mammoth'));
      const buf = Buffer.from(att.base64Data, 'base64');
      const result = await (mammoth as any).extractRawText({ buffer: buf });
      return result?.value ?? null;
    } catch {
      return null;
    }
  }

  // Unknown mime — caller renders a placeholder.
  return null;
}
