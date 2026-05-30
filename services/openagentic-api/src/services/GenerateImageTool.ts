/**
 * generate_image — T1 meta-tool for REAL image generation.
 *
 * Regression context: a user added an image-generation model
 * (`amazon.nova-canvas-v1:0`, role `image-generation`, the imageGen default)
 * and asked chat "create an image of a man on a computer". The model
 * fabricated an `<img src="https://source.unsplash.com/...">` tag instead of
 * a real image because the chat tool catalog had NO image-generation tool —
 * `generate_image` was deleted with the legacy `ChatPipeline.ts` in the #741
 * chatmode rip and never re-added. The provider method
 * `ILLMProvider.generateImage()` still exists; nothing in chat called it.
 *
 * This tool is the canonical sister of ComposeAppTool:
 *   - `GENERATE_IMAGE_TOOL` — the function tool def (name + description +
 *     parameters) injected into every chat turn's tool array.
 *   - `isGenerateImageTool(name)` — pure alias matcher (no regex on names).
 *   - `executeGenerateImage(ctx, input, deps)` — pure-ish handler. The
 *     provider→storage call is injected via `deps.generateImage` so the
 *     handler is unit-testable without ProviderManager / Milvus / blob IO.
 *
 * On success the handler emits a single `image_render` NDJSON frame the UI
 * renders inline (mirroring how compose_app emits `app_render`). On any
 * failure it returns `{ ok:false, error }` and emits NO frame — the model
 * receives the error as a tool result and MUST NOT fall back to fabricating
 * an external image URL.
 *
 * Architecture rule (mirrors ComposeAppTool / ComposeVisualTool):
 *   - NO regex tool-name matching anywhere in this file.
 *   - NO hardcoded model ids — the imageGen default model + its provider are
 *     resolved at the production-dep boundary (buildChatV2Deps / runChat),
 *     never as a literal in this pure handler.
 *   - NO external image hostnames — the only url shape this tool ever emits
 *     is the same-origin `/api/images/:id` path served by `routes/images.ts`.
 */

// ---------------------------------------------------------------------------
// Surface
// ---------------------------------------------------------------------------

export interface GenerateImageInput {
  /** Natural-language description of the image to generate. Required. */
  prompt: string;
  /** Output dimensions. Maps to ImageGenerationRequest.size. */
  size?: '1024x1024' | '1792x1024' | '1024x1792';
  /** Aesthetic hint. Maps to ImageGenerationRequest.style. */
  style?: 'vivid' | 'natural';
}

/**
 * Result of the injected generate-image dependency: a real generated image
 * already persisted to platform storage, addressed by a same-origin URL.
 */
export interface GeneratedImageResult {
  /** Same-origin URL served by routes/images.ts — e.g. /api/images/img_xxx.png */
  image_url: string;
  /** Stable storage id (stripped of extension). */
  artifact_id: string;
  /** Model that produced the image (resolved imageGen default). */
  model: string;
  /** Provider that owns the imageGen model. */
  provider: string;
  /** Raster format. */
  format: 'png' | 'jpeg' | 'webp';
  /** Provider-revised prompt (DALL-E style), when available. */
  revisedPrompt?: string;
}

/**
 * Injected dependency: resolve the platform imageGen default model + its
 * provider, call `provider.generateImage(...)`, persist the base64 PNG via
 * ImageStorageService, and return the same-origin url. Wired in
 * buildChatV2Deps / runChat; mocked in tests.
 */
export interface GenerateImageDeps {
  generateImage: (
    prompt: string,
    opts: { size?: GenerateImageInput['size']; style?: GenerateImageInput['style'] },
  ) => Promise<GeneratedImageResult>;
}

export interface GenerateImageResult {
  ok: boolean;
  artifact_id?: string;
  output?: string;
  error?: string;
}

interface GenerateImageContext {
  emit: (frameType: string, payload: unknown) => void;
  logger: {
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
    debug: (...args: unknown[]) => void;
  };
  sessionId?: string;
  userId?: string;
  /** Parent tool_use_id so parallel-tool fan-out binds the frame to the card. */
  toolUseId?: string;
}

const ALIAS_NAMES = new Set<string>([
  'generate_image',
  'generateImage',
  'generate.image',
  'GenerateImage',
]);

export function isGenerateImageTool(name: string): boolean {
  if (!name) return false;
  return ALIAS_NAMES.has(name);
}

// ---------------------------------------------------------------------------
// Tool description (Anthropic encyclopedia-article rubric: when to use, the
// hard anti-fabrication rule, what it returns).
// ---------------------------------------------------------------------------

const DESCRIPTION = [
  'Generate a NEW raster image from a text prompt via the platform\'s',
  'configured image model (the tenant\'s imageGen default — e.g. a Nova',
  'Canvas / Imagen / DALL-E deployment). Dispatch as a `tool_use` block',
  'named "generate_image".',
  '',
  'USE THIS TOOL when the user asks to create / generate / draw / make /',
  'render / design an image, picture, photo, logo, illustration, icon,',
  'diagram-as-image, or any visual raster artwork.',
  '',
  'HARD RULE — anti-fabrication: NEVER satisfy an image request by emitting',
  'an `<img src="https://...">` tag pointing at an external URL (unsplash,',
  'source.unsplash.com, placimg, picsum, lorempixel, or ANY external host).',
  'That is fabrication — those URLs are not the image the user asked for.',
  'Call this tool instead; it returns a real, freshly generated image hosted',
  'same-origin on this platform. Do NOT describe an image in prose as a',
  'substitute either — generate it.',
  '',
  'DO NOT USE for: charts / dashboards / data viz (use compose_visual or',
  'compose_app), or for editing an existing uploaded image (not supported).',
  '',
  'WHAT IT RETURNS: an `artifact_id` and a same-origin `/api/images/:id`',
  'url. The generated image mounts inline in the chat immediately. If image',
  'generation fails, you receive an error — relay it honestly; do NOT',
  'substitute an external image URL.',
].join('\n');

export const GENERATE_IMAGE_TOOL = {
  type: 'function',
  function: {
    name: 'generate_image',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: {
          type: 'string',
          description:
            'Detailed natural-language description of the image to generate. ' +
            'Be specific about subject, composition, style, lighting, and mood ' +
            'for the best result.',
        },
        size: {
          type: 'string',
          enum: ['1024x1024', '1792x1024', '1024x1792'],
          description:
            'Output dimensions. Square (1024x1024) by default; use a wide or ' +
            'tall aspect when the subject calls for it.',
        },
        style: {
          type: 'string',
          enum: ['vivid', 'natural'],
          description:
            'Aesthetic hint. "vivid" for hyper-real / dramatic, "natural" for ' +
            'more muted, true-to-life rendering. Optional.',
        },
      },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function executeGenerateImage(
  ctx: GenerateImageContext,
  input: GenerateImageInput,
  deps: GenerateImageDeps,
): Promise<GenerateImageResult> {
  const prompt = typeof input?.prompt === 'string' ? input.prompt.trim() : '';
  if (prompt.length === 0) {
    return { ok: false, error: 'prompt is required (non-empty string).' };
  }

  let generated: GeneratedImageResult;
  try {
    generated = await deps.generateImage(prompt, {
      size: input?.size,
      style: input?.style,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.error(
      { error: message, promptLength: prompt.length },
      '[generate_image] image generation failed',
    );
    // NEVER fall back to an external <img> URL. Return the error so the model
    // relays it honestly.
    return { ok: false, error: `Image generation failed: ${message}` };
  }

  // Defensive: a dep that returns an external URL would defeat the whole
  // anti-fabrication purpose. Refuse to emit it.
  if (
    typeof generated?.image_url !== 'string' ||
    generated.image_url.length === 0 ||
    /^https?:\/\//i.test(generated.image_url)
  ) {
    ctx.logger.error(
      { image_url: generated?.image_url },
      '[generate_image] dep returned a missing or external image_url — refusing to emit',
    );
    return {
      ok: false,
      error: 'Image generation returned an invalid (external or empty) url.',
    };
  }

  const artifact_id = generated.artifact_id;
  const payload = {
    artifact_id,
    image_url: generated.image_url,
    prompt,
    model: generated.model,
    provider: generated.provider,
    format: generated.format ?? 'png',
    alt: prompt,
    revised_prompt: generated.revisedPrompt ?? null,
    session_id: ctx.sessionId ?? null,
    // Parent tool_use_id so parallel-tool fan-out binds the frame to the card.
    tool_use_id: ctx.toolUseId ?? null,
    _meta: {
      outputTemplate: 'image_render',
    },
  };

  ctx.emit('image_render', payload);
  ctx.logger.info(
    {
      artifact_id,
      model: generated.model,
      provider: generated.provider,
      promptLength: prompt.length,
    },
    '[generate_image] emitted image_render',
  );

  // #1085 sidecar — fire-and-forget upsert into the user's per-user Milvus
  // memory collection so memory_search can surface this image on later turns
  // ("the bicycle image I made yesterday"). Wrapped — any Milvus issue is
  // swallowed; the primary image-gen path NEVER fails on a memory write.
  if (ctx.userId) {
    void (async () => {
      try {
        const { getMilvusMemoryService } = await import('./MilvusMemoryService.js');
        await getMilvusMemoryService(ctx.logger as any).upsertUserMemory(ctx.userId!, {
          kind: 'generated_image',
          title: prompt.slice(0, 200),
          content: `Generated image: "${prompt}" using ${generated.model} (${generated.provider}).`,
          artifactUrl: generated.image_url,
        });
      } catch (err: any) {
        ctx.logger.warn(
          { err: err?.message ?? String(err), artifact_id },
          '[generate_image] memory upsert failed — image still delivered to user',
        );
      }
    })();
  }

  // The model uses `output` to narrate the result; it does NOT introspect the
  // parallel `image_render` NDJSON frame. If we return a bare "image generated"
  // here, the model concludes the platform didn't actually deliver an artifact
  // and apologizes to the user (live regression on chat-dev 2026-05-24 with
  // Vertex Imagen 3 — the UI rendered the image perfectly, the model still
  // said "no artifact ID or URL"). Spell out the URL + id so the model knows
  // the image is already inline.
  const narratedOutput =
    `Image generated successfully and rendered inline in the chat as artifact "${artifact_id}" ` +
    `(url: ${generated.image_url}, model: ${generated.model}, provider: ${generated.provider}). ` +
    `The user can see the image now — do not describe it pixel-by-pixel; ` +
    `briefly confirm it was generated and ask if they want adjustments.`;
  return { ok: true, artifact_id, output: narratedOutput };
}
