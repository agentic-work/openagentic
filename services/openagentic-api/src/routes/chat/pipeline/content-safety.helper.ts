/**
 * Content Safety Helper
 *
 * Validates LLM responses for:
 * - Non-English content detection
 * - Repetition loop detection
 * - Maximum length enforcement
 *
 * BUG-007 Fix: Prevent language contamination and infinite repetition loops
 */

export interface ContentSafetyResult {
  isValid: boolean;
  issues: string[];
  cleanedContent?: string;
  truncated: boolean;
  hadRepetition: boolean;
  hadNonEnglish: boolean;
}

// Maximum response length (characters)
const MAX_RESPONSE_LENGTH = 50000;

// Repetition detection threshold
const REPETITION_THRESHOLD = 5; // If same phrase appears 5+ times, flag it

// Common Chinese character ranges
const CHINESE_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf]/g;

// Common Japanese character ranges (hiragana, katakana)
const JAPANESE_REGEX = /[\u3040-\u309f\u30a0-\u30ff]/g;

// Common Korean character ranges
const KOREAN_REGEX = /[\uac00-\ud7af\u1100-\u11ff]/g;

// Arabic character range
const ARABIC_REGEX = /[\u0600-\u06ff\u0750-\u077f]/g;

// Russian/Cyrillic character range
const CYRILLIC_REGEX = /[\u0400-\u04ff]/g;

/**
 * Detect if content contains significant non-English text
 * Returns the percentage of non-English characters
 */
export function detectNonEnglish(content: string): { hasNonEnglish: boolean; percentage: number; languages: string[] } {
  if (!content) return { hasNonEnglish: false, percentage: 0, languages: [] };

  const languages: string[] = [];
  let nonEnglishCount = 0;

  // Count Chinese characters
  const chineseMatches = content.match(CHINESE_REGEX) || [];
  if (chineseMatches.length > 10) {
    languages.push('Chinese');
    nonEnglishCount += chineseMatches.length;
  }

  // Count Japanese characters
  const japaneseMatches = content.match(JAPANESE_REGEX) || [];
  if (japaneseMatches.length > 10) {
    languages.push('Japanese');
    nonEnglishCount += japaneseMatches.length;
  }

  // Count Korean characters
  const koreanMatches = content.match(KOREAN_REGEX) || [];
  if (koreanMatches.length > 10) {
    languages.push('Korean');
    nonEnglishCount += koreanMatches.length;
  }

  // Count Arabic characters
  const arabicMatches = content.match(ARABIC_REGEX) || [];
  if (arabicMatches.length > 10) {
    languages.push('Arabic');
    nonEnglishCount += arabicMatches.length;
  }

  // Count Cyrillic characters
  const cyrillicMatches = content.match(CYRILLIC_REGEX) || [];
  if (cyrillicMatches.length > 10) {
    languages.push('Cyrillic');
    nonEnglishCount += cyrillicMatches.length;
  }

  const percentage = (nonEnglishCount / content.length) * 100;

  // Flag if more than 5% of content is non-English
  return {
    hasNonEnglish: percentage > 5,
    percentage,
    languages
  };
}

/**
 * Detect repetition patterns in content
 * Returns true if same phrase is repeated excessively
 */
export function detectRepetition(content: string): { hasRepetition: boolean; repeatedPhrases: string[] } {
  if (!content || content.length < 100) {
    return { hasRepetition: false, repeatedPhrases: [] };
  }

  const repeatedPhrases: string[] = [];

  // Check for common repetition patterns
  // Pattern 1: Repeated emoji sequences (like "加油！💪💪💪")
  const emojiPattern = /(.{5,50})\1{4,}/g;
  const emojiMatches = content.match(emojiPattern);
  if (emojiMatches) {
    repeatedPhrases.push(...emojiMatches.map(m => m.substring(0, 30) + '...'));
  }

  // Pattern 2: Repeated phrases (any phrase repeated 5+ times)
  const words = content.split(/\s+/);
  const phraseCount: Record<string, number> = {};

  // Check 3-word phrases
  for (let i = 0; i < words.length - 2; i++) {
    const phrase = words.slice(i, i + 3).join(' ').toLowerCase();
    if (phrase.length > 10) { // Ignore very short phrases
      phraseCount[phrase] = (phraseCount[phrase] || 0) + 1;
    }
  }

  // Find phrases that appear too many times
  for (const [phrase, count] of Object.entries(phraseCount)) {
    if (count >= REPETITION_THRESHOLD) {
      repeatedPhrases.push(`"${phrase}" (${count}x)`);
    }
  }

  // Pattern 3: Check for massive repetition of same line
  const lines = content.split('\n');
  const lineCount: Record<string, number> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 5) {
      lineCount[trimmed] = (lineCount[trimmed] || 0) + 1;
    }
  }

  for (const [line, count] of Object.entries(lineCount)) {
    if (count >= REPETITION_THRESHOLD) {
      repeatedPhrases.push(`Line repeated ${count}x: "${line.substring(0, 40)}..."`);
    }
  }

  return {
    hasRepetition: repeatedPhrases.length > 0,
    repeatedPhrases
  };
}

/**
 * Clean content by removing excessive repetition
 */
export function cleanRepetition(content: string): string {
  if (!content) return content;

  // Remove patterns of 10+ consecutive repeated phrases
  let cleaned = content.replace(/(.{10,100})\1{9,}/g, '$1$1$1 [content truncated due to repetition]');

  // Remove excessive emoji repetition
  cleaned = cleaned.replace(/([\u{1F300}-\u{1F9FF}]\s*){10,}/gu, '$1$1$1 ');

  // BUG FIX: Remove word-level repetition patterns like "finalized results. finalized results."
  // Match any 2-3 word phrase repeated 5+ times with punctuation/spaces between
  const wordRepeatPatterns = [
    // Phrases like "finalized results" repeated with periods
    /(\b\w+\s+\w+\.?\s*){10,}/gi,
    // Single words repeated many times like "synthesize. synthesize."
    /(\b\w{5,}\b[.\s]+){10,}/gi,
    // "ize" words repeated (synthesize, finalize, etc.)
    /(\b\w+ize\b[.\s,!]+){5,}/gi
  ];

  for (const pattern of wordRepeatPatterns) {
    const matches = cleaned.match(pattern);
    if (matches) {
      for (const match of matches) {
        if (match.length > 100) { // Only clean if it's a substantial repetition
          // Extract the base phrase and keep just 2 instances
          const baseMatch = match.match(/\b(\w+\s+\w+)[.\s]+/);
          if (baseMatch) {
            cleaned = cleaned.replace(match, `${baseMatch[1]}. [Repetitive content removed]`);
          } else {
            cleaned = cleaned.replace(match, '[Repetitive content removed]');
          }
        }
      }
    }
  }

  // Final safety: if content still has more than 50% repeated 2-grams, truncate aggressively
  const words = cleaned.split(/\s+/);
  if (words.length > 100) {
    const bigrams = new Map<string, number>();
    for (let i = 0; i < words.length - 1; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`.toLowerCase();
      bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
    }
    const totalBigrams = words.length - 1;
    const uniqueBigrams = bigrams.size;
    const repetitionRatio = 1 - (uniqueBigrams / totalBigrams);

    if (repetitionRatio > 0.7) { // More than 70% repeated content
      // Find where content starts repeating and truncate there
      const seenBigrams = new Set<string>();
      let truncateAt = words.length;
      for (let i = 0; i < words.length - 1; i++) {
        const bigram = `${words[i]} ${words[i + 1]}`.toLowerCase();
        if (seenBigrams.has(bigram)) {
          // Count how many repeats follow
          let repeatCount = 0;
          for (let j = i; j < Math.min(i + 20, words.length - 1); j++) {
            const testBigram = `${words[j]} ${words[j + 1]}`.toLowerCase();
            if (seenBigrams.has(testBigram)) repeatCount++;
          }
          if (repeatCount > 10) {
            truncateAt = i;
            break;
          }
        }
        seenBigrams.add(bigram);
      }

      if (truncateAt < words.length) {
        cleaned = words.slice(0, truncateAt).join(' ') + '\n\n[Response truncated due to repetitive content]';
      }
    }
  }

  return cleaned;
}

/**
 * Main content safety validation function
 */
export function validateContentSafety(content: string, logger?: any): ContentSafetyResult {
  const issues: string[] = [];
  let cleanedContent = content;
  let truncated = false;
  let hadRepetition = false;
  let hadNonEnglish = false;

  if (!content) {
    return {
      isValid: true,
      issues: [],
      truncated: false,
      hadRepetition: false,
      hadNonEnglish: false
    };
  }

  // Check 1: Maximum length
  if (content.length > MAX_RESPONSE_LENGTH) {
    issues.push(`Response exceeded max length (${content.length} > ${MAX_RESPONSE_LENGTH})`);
    cleanedContent = content.substring(0, MAX_RESPONSE_LENGTH) + '\n\n[Response truncated due to excessive length]';
    truncated = true;

    if (logger) {
      logger.warn({
        originalLength: content.length,
        maxLength: MAX_RESPONSE_LENGTH
      }, '[CONTENT-SAFETY] Response truncated due to excessive length');
    }
  }

  // Check 2: Non-English content
  const nonEnglishResult = detectNonEnglish(content);
  if (nonEnglishResult.hasNonEnglish) {
    hadNonEnglish = true;
    issues.push(`Non-English content detected: ${nonEnglishResult.languages.join(', ')} (${nonEnglishResult.percentage.toFixed(1)}%)`);

    if (logger) {
      logger.warn({
        languages: nonEnglishResult.languages,
        percentage: nonEnglishResult.percentage
      }, '[CONTENT-SAFETY] Non-English content detected in response');
    }

    // If more than 30% non-English, add a warning to the content
    if (nonEnglishResult.percentage > 30) {
      cleanedContent = `**Warning: The AI response contained unexpected non-English content which has been flagged. Please try your request again.**\n\n---\n\n${cleanedContent}`;
    }
  }

  // Check 3: Repetition
  const repetitionResult = detectRepetition(content);
  if (repetitionResult.hasRepetition) {
    hadRepetition = true;
    issues.push(`Repetition detected: ${repetitionResult.repeatedPhrases.slice(0, 3).join(', ')}`);

    if (logger) {
      logger.warn({
        repeatedPhrases: repetitionResult.repeatedPhrases.slice(0, 5)
      }, '[CONTENT-SAFETY] Repetition pattern detected in response');
    }

    // Clean the repetition
    cleanedContent = cleanRepetition(cleanedContent);
  }

  return {
    isValid: issues.length === 0,
    issues,
    cleanedContent: issues.length > 0 ? cleanedContent : undefined,
    truncated,
    hadRepetition,
    hadNonEnglish
  };
}

export default {
  validateContentSafety,
  detectNonEnglish,
  detectRepetition,
  cleanRepetition
};
