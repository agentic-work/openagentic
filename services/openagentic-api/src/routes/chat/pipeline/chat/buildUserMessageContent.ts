/**
 * buildUserMessageContent — attachment-aware user-message body builder.
 *
 * Builds the user message `content` field. Handles the three drag-drop
 * shapes the platform supports:
 *   - image/* → OpenAI multimodal `image_url` block (vision models read
 *     the bytes directly).
 *   - PDF / DOCX / text-family → server-side extracted text injected as
 *     a labelled text block, so non-vision models can still answer
 *     questions about the file.
 *   - no attachments → plain string (preserves prefix-cache stability
 *     for the 99% of turns that don't carry a file).
 *
 * Async because PDF/DOCX extraction is async (pdf-parse + mammoth lazy
 * imports). Ported from the legacy V2 pipeline as part of the #741 /
 * B-vrip step 6 rip.
 */
import type { RunChatInput } from './types.js';

export async function buildUserMessageContent(
  userMessage: string,
  attachments: RunChatInput['attachments'],
): Promise<
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>
> {
  if (!attachments || attachments.length === 0) {
    return userMessage;
  }
  const imageBlocks = attachments
    .filter(a => a && a.base64Data && a.mimeType?.startsWith('image/'))
    .map(a => ({
      type: 'image_url' as const,
      image_url: { url: `data:${a.mimeType};base64,${a.base64Data}` },
    }));

  // Extract text from non-image attachments (PDF/DOCX/text-family). Run
  // in parallel — every extractor is independent.
  const { extractAttachmentText } = await import('./extractAttachmentText.js');
  const docAttachments = attachments.filter(
    a => a && a.base64Data && !a.mimeType?.startsWith('image/'),
  );
  const extracted = await Promise.all(
    docAttachments.map(async a => ({ att: a, text: await extractAttachmentText(a as any) })),
  );
  const docTextBlocks = extracted
    .filter(x => x.text && x.text.trim().length > 0)
    .map(x => ({
      type: 'text' as const,
      text: `[Attached file: ${x.att.originalName ?? 'file'} (${x.att.mimeType})]\n${x.text}`,
    }));

  if (imageBlocks.length === 0 && docTextBlocks.length === 0) {
    return userMessage;
  }
  return [
    { type: 'text' as const, text: userMessage },
    ...docTextBlocks,
    ...imageBlocks,
  ];
}
