/**
 * Image Generation Tool — Exposes image generation as a callable tool
 * for artifact agents (and other agents) via the tool dispatch chain.
 *
 * Wraps ImageGenerationService + ImageStorageService so agents can
 * generate and embed images in their output (e.g., artifact HTML).
 */

import { ImageStorageService } from '../../../services/ImageStorageService.js';
import { getRedisClient } from '../../../utils/redis-client.js';
import type { Logger } from 'pino';
import os from 'os';

// Singleton instances (lazy-initialized)
let imageStorageService: ImageStorageService | null = null;

const TOOL_NAME = 'generate_image';

// Rate limit constants
const RATE_LIMIT_PER_EXECUTION = 5;
const RATE_LIMIT_PER_USER_HOUR = 10;
const RATE_LIMIT_KEY_PREFIX = 'img_gen_rate:';

export function isImageGenTool(name: string): boolean {
  return name === TOOL_NAME;
}

export function getImageGenToolDefinition() {
  return {
    type: 'function' as const,
    function: {
      name: TOOL_NAME,
      description:
        'Generate an image from a text prompt. Returns imageUrl (for HTML artifacts: <img src="...">) and markdownImage (for inline display in your response). ' +
        'IMPORTANT: After generating images, you MUST include them inline in your response text using the markdownImage syntax, e.g. ![description](image://img_xxx). ' +
        'Also embed them in any HTML artifact using imageUrl. Max 3 images per task.',
      parameters: {
        type: 'object',
        required: ['prompt'],
        properties: {
          prompt: {
            type: 'string',
            description: 'Detailed description of the image to generate. Be specific about subject, style, composition, and colors.',
          },
          size: {
            type: 'string',
            enum: ['1024x1024', '1792x1024', '1024x1792'],
            description: 'Image dimensions. Default: 1024x1024. Use 1792x1024 for landscape, 1024x1792 for portrait.',
          },
          style: {
            type: 'string',
            enum: ['vivid', 'natural'],
            description: 'Image style. vivid = hyper-real/dramatic. natural = realistic/subtle. Default: natural.',
          },
        },
      },
    },
  };
}

export interface ImageGenToolContext {
  userId: string;
  sessionId?: string;
  executionId?: string;
  logger: Logger;
  /** ProviderManager instance for routing image gen through the unified provider system */
  providerManager?: any;
}

export async function executeImageGenTool(
  toolCallId: string,
  args: { prompt: string; size?: string; style?: string },
  context: ImageGenToolContext,
) {
  const { userId, logger } = context;
  const startTime = Date.now();

  // --- Rate limiting (uses get/set since UnifiedRedisClient doesn't expose incr) ---
  try {
    const redis = getRedisClient();
    if (redis) {
      // Per-user hourly limit
      const hourlyKey = `${RATE_LIMIT_KEY_PREFIX}hourly:${userId}`;
      const hourlyVal = await redis.get(hourlyKey);
      const hourlyCount = (hourlyVal ? Number.parseInt(String(hourlyVal), 10) : 0) + 1;
      await redis.set(hourlyKey, hourlyCount, 3600);
      if (hourlyCount > RATE_LIMIT_PER_USER_HOUR) {
        return {
          toolCallId,
          toolName: TOOL_NAME,
          result: { error: `Rate limit exceeded: max ${RATE_LIMIT_PER_USER_HOUR} images per hour` },
          error: `Rate limit exceeded: max ${RATE_LIMIT_PER_USER_HOUR} images per hour`,
          serverName: 'image-gen',
          executedOn: os.hostname(),
          executionTimeMs: Date.now() - startTime,
        };
      }

      // Per-execution limit
      if (context.executionId) {
        const execKey = `${RATE_LIMIT_KEY_PREFIX}exec:${context.executionId}`;
        const execVal = await redis.get(execKey);
        const execCount = (execVal ? Number.parseInt(String(execVal), 10) : 0) + 1;
        await redis.set(execKey, execCount, 600);
        if (execCount > RATE_LIMIT_PER_EXECUTION) {
          return {
            toolCallId,
            toolName: TOOL_NAME,
            result: { error: `Rate limit exceeded: max ${RATE_LIMIT_PER_EXECUTION} images per agent execution` },
            error: `Rate limit exceeded: max ${RATE_LIMIT_PER_EXECUTION} images per agent execution`,
            serverName: 'image-gen',
            executedOn: os.hostname(),
            executionTimeMs: Date.now() - startTime,
          };
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, '[IMAGE-GEN-TOOL] Rate limit check failed (non-fatal)');
  }

  // --- Generate image via unified provider system ---
  try {
    const providerManager = context.providerManager || (global as any).providerManager;
    if (!providerManager || typeof providerManager.generateImage !== 'function') {
      throw new Error('ProviderManager not available — cannot generate images');
    }

    const result = await providerManager.generateImage({
      prompt: args.prompt,
      size: (args.size || '1024x1024') as any,
      style: (args.style as 'vivid' | 'natural') || 'natural',
    });

    // Store image and return a URL
    let imageUrl: string | undefined;
    if (result.imageBase64) {
      try {
        if (!imageStorageService) {
          imageStorageService = new ImageStorageService(logger);
        }
        // Ensure storage is connected (Milvus + MinIO)
        if (!(imageStorageService as any).connected) {
          await imageStorageService.connect();
        }
        const imageId = await imageStorageService.storeImage(
          result.imageBase64,
          args.prompt,
          userId,
          {
            model: result.model,
            revisedPrompt: result.revisedPrompt,
            dimensions: args.size || '1024x1024',
            generationTime: result.generationTimeMs,
          },
        );
        // Strip .png extension from ID (BlobStorageService returns ID with extension)
        const cleanId = imageId?.replace(/\.png$/, '') || imageId;
        imageUrl = `/api/images/${cleanId}.png`;
      } catch (storeErr) {
        logger.warn({ err: storeErr }, '[IMAGE-GEN-TOOL] Failed to store image, returning base64 data URI');
        imageUrl = `data:image/png;base64,${result.imageBase64}`;
      }
    }

    // Log without base64 data to prevent log bloat (base64 can be 5-10MB)
    const logSafeUrl = imageUrl?.startsWith('data:') ? `data:image/png;base64,[${Math.round((imageUrl.length - 22) * 3 / 4 / 1024)}KB]` : imageUrl;
    logger.info({
      toolCallId,
      prompt: args.prompt.substring(0, 100),
      imageUrl: logSafeUrl,
      responseTimeMs: result.generationTimeMs,
    }, '[IMAGE-GEN-TOOL] Image generated successfully');

    const cleanImageId = imageUrl?.replace(/^\/api\/images\//, '').replace(/\.png$/, '');
    return {
      toolCallId,
      toolName: TOOL_NAME,
      result: {
        imageUrl,
        imageId: cleanImageId,
        markdownImage: `![${args.prompt.substring(0, 80)}](image://${cleanImageId})`,
        revisedPrompt: result.revisedPrompt,
        provider: result.provider,
        model: result.model,
      },
      serverName: 'image-gen',
      executedOn: os.hostname(),
      executionTimeMs: Date.now() - startTime,
    };
  } catch (error: any) {
    logger.error({ err: error, toolCallId }, '[IMAGE-GEN-TOOL] Image generation failed');
    return {
      toolCallId,
      toolName: TOOL_NAME,
      result: null,
      error: `Image generation failed: ${error.message}`,
      serverName: 'image-gen',
      executedOn: os.hostname(),
      executionTimeMs: Date.now() - startTime,
    };
  }
}
