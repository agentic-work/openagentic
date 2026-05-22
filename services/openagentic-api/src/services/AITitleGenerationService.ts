/**
 * AI-Powered Title Generation Service
 *
 * Uses AI to intelligently generate conversation titles
 * instead of relying on hardcoded patterns
 */

import { Logger } from 'pino';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions.js';
import { ModelConfigurationService } from './ModelConfigurationService.js';
import { DEFAULT_SERVICE_PROMPTS } from './prompt/ServicePromptService.js';

// Minimal interface for injected ServicePromptService (Sprint W).
interface ServicePromptLike {
  getPrompt(key: string): Promise<string>;
}

// Use the existing ChatMessage type from session service
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
}

interface TitleGenerationOptions {
  maxLength?: number;
  style?: 'concise' | 'descriptive' | 'creative';
  language?: string;
  useLLM?: boolean;
}

interface TitleClient {
  generateCompletion(params: {
    model?: string;
    messages: ChatCompletionMessageParam[];
    temperature?: number;
    max_tokens?: number;
  }): Promise<{ content: string }>;
}

export class AITitleGenerationService {
  private logger: Logger;
  private titleClient?: TitleClient;
  private cache: Map<string, string> = new Map();
  private readonly maxCacheSize = 1000;
  private readonly defaultMaxLength = 60;
  /** Sprint W (2026-05-19) — optional injected ServicePromptService for DB-backed prompt. */
  private _servicePromptSvc?: ServicePromptLike;

  constructor(
    logger: Logger,
    private options: TitleGenerationOptions = {},
    titleClient?: TitleClient,
    servicePromptSvc?: ServicePromptLike,
  ) {
    this.logger = logger.child({ service: 'AITitleGeneration' });
    this.titleClient = titleClient;
    this._servicePromptSvc = servicePromptSvc;
    this.options = {
      maxLength: this.defaultMaxLength,
      style: 'concise',
      language: 'en',
      useLLM: true,
      ...options
    };
  }

  /**
   * Generate a title for a chat session using AI
   */
  async generateTitle(
    messages: ChatMessage[] | { content: string; role: string }[]
  ): Promise<string> {
    try {
      // Extract the first user message
      const firstUserMessage = messages.find(m => m.role === 'user');
      if (!firstUserMessage || !firstUserMessage.content) {
        return this.generateFallbackTitle();
      }

      // Check cache first
      const cacheKey = this.getCacheKey(firstUserMessage.content);
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey)!;
      }

      // Try AI generation first if available
      if (this.options.useLLM && this.titleClient) {
        try {
          const aiTitle = await this.generateAITitle(firstUserMessage.content, messages);
          if (aiTitle && aiTitle.length > 3) {
            this.cacheTitle(cacheKey, aiTitle);
            return aiTitle;
          }
        } catch (aiError) {
          this.logger.warn({ error: aiError }, 'AI title generation failed, falling back to smart extraction');
        }
      }

      // Fallback to smart extraction
      const extractedTitle = this.smartExtractTitle(firstUserMessage.content);
      this.cacheTitle(cacheKey, extractedTitle);
      return extractedTitle;

    } catch (error) {
      this.logger.error({ error }, 'Title generation failed');
      return this.generateFallbackTitle();
    }
  }

  /**
   * Generate title using AI
   */
  private async generateAITitle(
    userMessage: string,
    allMessages: ChatMessage[] | { content: string; role: string }[]
  ): Promise<string> {
    if (!this.titleClient) {
      throw new Error('Title generation client not configured');
    }

    // Create a focused prompt for title generation (Sprint W: DB-backed when available)
    const systemPrompt = await this.getTitleGenerationPrompt((this as any)._servicePromptSvc);
    
    // Include context from the conversation if available
    const contextMessages = allMessages.slice(0, 3).map(m => ({
      role: m.role,
      content: m.content.substring(0, 500) // Limit content length
    }));

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...contextMessages as ChatCompletionMessageParam[],
      {
        role: 'user',
        content: `Generate a title for this conversation that started with: "${userMessage.substring(0, 500)}"`
      }
    ];

    try {
      // Resolve model from DB (SoT) — no env reads on live path
      const titleAssignment = await ModelConfigurationService.getServiceModel('titleGeneration');
      const resolvedModel = titleAssignment?.modelId ?? await ModelConfigurationService.getDefaultChatModel();
      const response = await this.titleClient.generateCompletion({
        model: resolvedModel,
        messages,
        temperature: 0.3, // Lower temperature for more consistent titles
        max_tokens: 20 // Titles should be short
      });

      const generatedTitle = this.cleanGeneratedTitle(response.content);

      // Validate the generated title
      if (this.isValidTitle(generatedTitle)) {
        return this.truncateTitle(generatedTitle);
      }

      this.logger.warn({
        rawResponse: response.content,
        cleanedTitle: generatedTitle,
        titleLength: generatedTitle.length
      }, 'Generated title failed validation - falling back to smart extraction');

      throw new Error('Generated title failed validation');
    } catch (error) {
      // Bug 2 (2026-05-18): outer caller `generateTitle` already logs a `warn`
      // when this path falls through to smartExtract. Logging at error here
      // was duplicate spam on every first-message turn. Debug level keeps the
      // signal for deep inspection without polluting prod logs.
      this.logger.debug({ error }, 'AI title generation failed — falling back');
      throw error;
    }
  }

  /**
   * Sprint W (2026-05-19) — DB-backed title generation prompt.
   *
   * When `servicePromptSvc` is provided reads from DB key `title_gen.ai_service`.
   * Falls back to DEFAULT_SERVICE_PROMPTS default when unavailable.
   */
  async getTitleGenerationPrompt(servicePromptSvc?: ServicePromptLike): Promise<string> {
    let fallbackReason = 'NO-SVC-INJECTED';
    if (servicePromptSvc) {
      try {
        return await servicePromptSvc.getPrompt('title_gen.ai_service');
      } catch (err) {
        fallbackReason = 'DB-READ-THREW';
        this.logger.warn(
          { err, key: 'title_gen.ai_service', reason: fallbackReason },
          '[AITitleGen] DB prompt read failed, using inline default',
        );
      }
    }
    // Gap #3 — emit a loud fallback signal so DEFAULT_SERVICE_PROMPTS drift
    // from the DB row becomes visible.
    this.logger.warn(
      { key: 'title_gen.ai_service', reason: fallbackReason },
      '[ServicePrompt fallback] using DEFAULT_SERVICE_PROMPTS constant — DB row missing or read failed (title_gen.ai_service)',
    );
    return DEFAULT_SERVICE_PROMPTS['title_gen.ai_service'].body;
  }

  /**
   * Create the system prompt for title generation.
   * @deprecated Use getTitleGenerationPrompt(servicePromptSvc) for DB-backed prompt (Sprint W).
   */
  private createTitleGenerationPrompt(): string {
    // Gap #3 — even the deprecated path screams when it returns the inline
    // constant so we can spot any lingering callers in production logs.
    this.logger.warn(
      { key: 'title_gen.ai_service', reason: 'DEPRECATED-SYNC-PATH' },
      '[ServicePrompt fallback] using DEFAULT_SERVICE_PROMPTS constant — DB row missing or read failed (title_gen.ai_service @ legacy sync path)',
    );
    return DEFAULT_SERVICE_PROMPTS['title_gen.ai_service'].body;
  }

  /**
   * Smart extraction without AI (improved fallback)
   */
  private smartExtractTitle(content: string): string {
    // Remove code blocks and clean content
    const cleanContent = this.removeCodeBlocks(content);
    
    // Extract key phrases using NLP-like patterns
    const keyPhrases = this.extractKeyPhrases(cleanContent);
    
    if (keyPhrases.length > 0) {
      // Combine top key phrases into a title
      const title = keyPhrases
        .slice(0, 3)
        .map(phrase => this.capitalizePhrase(phrase))
        .join(' ');
      
      return this.truncateTitle(title);
    }

    // Last resort: extract first sentence
    return this.extractFirstSentence(cleanContent);
  }

  /**
   * Extract key phrases from text
   */
  private extractKeyPhrases(text: string): string[] {
    const phrases: string[] = [];
    
    // Common patterns for important phrases. Each entry tracks whether to
    // use the FULL match (verb + object — "fix authentication") or just the
    // semantic OBJECT (group 2 — "send to the CTO" without leading "Can").
    // #318: Question-starter words ("can/what/how/why") leaked into title
    // heads ("Can Send to the Cto"); fix is to drop them via group 2 only.
    const patterns: Array<{ regex: RegExp; useFull: boolean }> = [
      // Technical terms — verb conveys intent, keep full match.
      { regex: /\b(implement|create|build|fix|debug|optimize|refactor|deploy|configure|setup|install)\s+(\w+(?:\s+\w+){0,2})/gi, useFull: true },
      // Questions — drop the question-starter, keep the object only.
      { regex: /\b(?:what|how|why|when|where|can|should|would|could)\s+(?:you\s+|the\s+|a\s+|an\s+|i\s+)?(\w+(?:\s+\w+){0,3})/gi, useFull: false },
      // Concepts — verb conveys intent, keep full match.
      { regex: /\b(explain|understand|learn|about)\s+(\w+(?:\s+\w+){0,2})/gi, useFull: true },
      // Errors and issues — keep full ("error in auth").
      { regex: /\b(error|issue|problem|bug|crash|fail|wrong)\s+(?:with\s+)?(\w+(?:\s+\w+){0,2})/gi, useFull: true },
      // Technologies (common ones) — single token.
      { regex: /\b(react|vue|angular|python|javascript|typescript|java|go|rust|docker|kubernetes|aws|azure|gcp|api|database|sql|mongodb|redis)\b/gi, useFull: true },
    ];

    for (const { regex, useFull } of patterns) {
      const matches = text.matchAll(regex);
      for (const match of matches) {
        // Preserve original casing (acronyms like "CTO" / "API" / "SQL");
        // capitalizePhrase below leaves all-uppercase tokens intact.
        const phrase = (useFull ? match[0] : match[1] ?? match[0]).trim();
        if (phrase.length > 3 && phrase.length < 30) {
          phrases.push(phrase);
        }
      }
    }

    // Score phrases by relevance (frequency and position)
    const phraseScores = new Map<string, number>();
    phrases.forEach((phrase, index) => {
      const current = phraseScores.get(phrase) || 0;
      // Higher score for phrases appearing earlier
      phraseScores.set(phrase, current + (phrases.length - index));
    });

    // Sort by score and return top phrases
    return Array.from(phraseScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([phrase]) => phrase);
  }

  /**
   * Remove code blocks from content
   */
  private removeCodeBlocks(content: string): string {
    return content
      .replace(/```[\s\S]*?```/g, '')
      .replace(/`[^`]+`/g, '')
      .replace(/^\s*[<>|]/gm, '') // Remove quote markers
      .trim();
  }

  /**
   * Extract first meaningful sentence
   */
  private extractFirstSentence(text: string): string {
    // Remove common conversation starters
    const cleaned = text
      .replace(/^(hey|hi|hello|please|can you|could you|i need|i want|help me|show me)\s+/gi, '')
      .trim();
    
    // Get first sentence or line
    const firstSentence = cleaned.split(/[.!?\n]/)[0].trim();
    
    if (firstSentence && firstSentence.length > 3) {
      return this.truncateTitle(this.capitalizePhrase(firstSentence));
    }
    
    return this.generateFallbackTitle();
  }

  /**
   * Clean generated title from AI
   */
  private cleanGeneratedTitle(title: string): string {
    return title
      .replace(/^["']|["']$/g, '') // Remove surrounding quotes
      .replace(/^\*{1,2}(.*?)\*{1,2}$/, '$1') // Strip markdown bold/italic (**text** or *text*)
      .replace(/^`(.*)`$/, '$1') // Strip surrounding backticks
      // Strip LLM preambles like "Sure, here is the title:" / "The title is:"
      // — any short prefix ending with a colon whose left side contains "title".
      // Bounded length avoids stripping a real sentence that happens to contain
      // the word "title" mid-prose. Bug 2 (2026-05-18).
      .replace(/^[^:\n]{0,80}?\btitle\b[^:\n]{0,30}:\s*/i, '')
      .replace(/^Title:\s*/i, '') // Remove bare "Title:" prefix (preamble regex misses this)
      .replace(/\.$/, '') // Remove trailing period
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }

  /**
   * Validate generated title
   */
  private isValidTitle(title: string): boolean {
    if (!title || title.length < 3 || title.length > 100) {
      return false;
    }

    // Check for common AI failures
    const invalidPatterns = [
      /^(sure|here|okay|the title is)/i,
      /^(conversation|chat|discussion)$/i,
      /[<>{}[\]]/,  // No special characters
      /^\d+$/,       // Not just numbers
    ];
    
    return !invalidPatterns.some(pattern => pattern.test(title));
  }

  /**
   * Capitalize phrase properly
   */
  private capitalizePhrase(phrase: string): string {
    // List of words that should stay lowercase (unless first word)
    const lowercaseWords = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were']);

    return phrase
      .split(/\s+/)
      .map((word, index) => {
        if (!word) return word;
        const lower = word.toLowerCase();
        // #318: preserve all-uppercase acronyms verbatim ("CTO" / "API" /
        // "SQL"). Previous code force-cased them through
        // charAt(0).toUpperCase() + slice(1).toLowerCase() — turning "CTO"
        // into "Cto" — which produced live titles like "Can Send to the Cto".
        if (word.length >= 2 && word === word.toUpperCase() && /[A-Z]/.test(word)) {
          return word;
        }
        if (index === 0 || !lowercaseWords.has(lower)) {
          return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        }
        return lower;
      })
      .join(' ');
  }

  /**
   * Truncate title to max length
   */
  private truncateTitle(title: string): string {
    const maxLength = this.options.maxLength || this.defaultMaxLength;
    if (title.length <= maxLength) {
      return title;
    }
    
    // Try to truncate at word boundary
    const truncated = title.substring(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');
    
    if (lastSpace > maxLength * 0.8) {
      return truncated.substring(0, lastSpace) + '...';
    }
    
    return truncated + '...';
  }

  /**
   * Generate fallback title when all else fails
   */
  private generateFallbackTitle(): string {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit',
      hour12: true 
    });
    const dateStr = now.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric' 
    });
    
    return `Chat ${dateStr} ${timeStr}`;
  }

  /**
   * Get cache key for a message
   */
  private getCacheKey(content: string): string {
    // Use first 200 chars as cache key
    return content.substring(0, 200).toLowerCase().replace(/\s+/g, ' ');
  }

  /**
   * Cache a generated title
   */
  private cacheTitle(key: string, title: string): void {
    // Implement LRU cache
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, title);
  }

  /**
   * Clear the cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Update options
   */
  updateOptions(options: Partial<TitleGenerationOptions>): void {
    this.options = { ...this.options, ...options };
  }
}