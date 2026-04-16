/**
 * Image Generation Intent Detection Helper
 *
 * Detects when user messages are requesting image generation
 * and extracts the image prompt from the request.
 */

export interface ImageIntentResult {
  isImageRequest: boolean;
  imagePrompt?: string;
  originalMessage: string;
}

export function detectImageIntent(message: string): ImageIntentResult {
  const lowerMessage = message.toLowerCase();

  // Keywords that indicate image generation request
  const imageKeywords = [
    'generate an image',
    'create an image',
    'make an image',
    'draw an image',
    'generate a picture',
    'create a picture',
    'make a picture',
    'draw a picture',
    'show me an image',
    'show me a picture',
    'can you draw',
    'can you create',
    'can you generate',
    'create me an image',
    'generate me an image',
    // Additional patterns to catch more image requests
    'give me an image',
    'give me a picture',
    'give me a photo',
    'can you give me an image',
    'can you give me a picture',
    'can you give me a photo',
    'show an image',
    'display an image',
    'i want an image',
    'i need an image',
    'i\'d like an image',
    'please make me an image',
    'make me a picture',
    'visualize',
    'render an image',
    'paint me',
    'paint an image',
    'illustrate'
  ];

  // Check if message contains image generation keywords
  const isImageRequest = imageKeywords.some(keyword => lowerMessage.includes(keyword));

  if (!isImageRequest) {
    return {
      isImageRequest: false,
      originalMessage: message
    };
  }

  // Extract the actual prompt by removing the command keywords
  let imagePrompt = message;

  // Remove common prefixes
  const prefixes = [
    /^(please\s+)?generate\s+(an?\s+)?image\s+(of|showing|with)?\s*/i,
    /^(please\s+)?create\s+(an?\s+)?image\s+(of|showing|with)?\s*/i,
    /^(please\s+)?make\s+(an?\s+)?image\s+(of|showing|with)?\s*/i,
    /^(please\s+)?draw\s+(an?\s+)?image\s+(of|showing|with)?\s*/i,
    /^(please\s+)?show\s+me\s+(an?\s+)?image\s+(of|showing|with)?\s*/i,
    /^(please\s+)?generate\s+(an?\s+)?picture\s+(of|showing|with)?\s*/i,
    /^(please\s+)?create\s+(an?\s+)?picture\s+(of|showing|with)?\s*/i,
    /^can\s+you\s+(please\s+)?(draw|create|generate|make|give\s+me)\s+(an?\s+)?(image|picture|photo)\s+(of|showing|with)?\s*/i,
    // Additional prefix patterns for new keywords
    /^(please\s+)?give\s+me\s+(an?\s+)?(image|picture|photo)\s+(of|showing|with)?\s*/i,
    /^(please\s+)?show\s+(an?\s+)?image\s+(of|showing|with)?\s*/i,
    /^(please\s+)?display\s+(an?\s+)?image\s+(of|showing|with)?\s*/i,
    /^i\s+(want|need|'d\s+like)\s+(an?\s+)?image\s+(of|showing|with)?\s*/i,
    /^(please\s+)?render\s+(an?\s+)?image\s+(of|showing|with)?\s*/i,
    /^(please\s+)?paint\s+(me\s+)?(an?\s+)?(image|picture)?\s*(of|showing|with)?\s*/i,
    /^(please\s+)?illustrate\s*/i,
    /^(please\s+)?visualize\s*/i
  ];

  for (const prefix of prefixes) {
    imagePrompt = imagePrompt.replace(prefix, '');
  }

  // Clean up the prompt
  imagePrompt = imagePrompt.trim();

  // If the prompt is empty or too short after extraction, use original message
  if (imagePrompt.length < 3) {
    imagePrompt = message;
  }

  return {
    isImageRequest: true,
    imagePrompt: imagePrompt,
    originalMessage: message
  };
}
