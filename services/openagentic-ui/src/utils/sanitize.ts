/**
 * HTML/SVG Sanitization Utilities
 *
 * Uses DOMPurify to prevent XSS attacks when rendering untrusted content.
 * ALWAYS use these functions when rendering content from:
 * - LLM responses
 * - User input
 * - External APIs
 */

import DOMPurify from 'dompurify';

type DOMPurifyConfig = Record<string, any>;

// Configure DOMPurify for SVG content
const SVG_CONFIG: DOMPurifyConfig = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ['use', 'image', 'feGaussianBlur', 'feOffset', 'feBlend', 'feMerge', 'feMergeNode'],
  ADD_ATTR: ['xlink:href', 'href', 'preserveAspectRatio', 'viewBox', 'xmlns', 'xmlns:xlink'],
  // Remove dangerous attributes
  FORBID_ATTR: ['onclick', 'onload', 'onerror', 'onmouseover', 'onfocus', 'onblur'],
  // Remove script tags and javascript: URLs
  FORBID_TAGS: ['script', 'style'],
  RETURN_DOM_FRAGMENT: false,
  RETURN_DOM: false,
};

// Configure DOMPurify for HTML content (code highlighting, markdown)
const HTML_CONFIG: DOMPurifyConfig = {
  USE_PROFILES: { html: true },
  // Allow common HTML elements for markdown/code
  ADD_TAGS: ['pre', 'code', 'span', 'div', 'p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote', 'hr'],
  ADD_ATTR: ['class', 'style', 'href', 'target', 'rel', 'data-line', 'data-language'],
  // Remove dangerous attributes
  FORBID_ATTR: ['onclick', 'onload', 'onerror', 'onmouseover', 'onfocus', 'onblur', 'onsubmit'],
  // Remove script tags
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input'],
  // Transform javascript: URLs to safe values
  ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|sms|cid|xmpp|xxx):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  RETURN_DOM_FRAGMENT: false,
  RETURN_DOM: false,
};

// Strict config for inline styles (only allow safe CSS)
const STYLE_CONFIG: DOMPurifyConfig = {
  USE_PROFILES: { html: true },
  ADD_TAGS: ['style'],
  FORCE_BODY: true,
  RETURN_DOM_FRAGMENT: false,
  RETURN_DOM: false,
};

/**
 * Sanitize SVG content from LLM or external sources
 */
export function sanitizeSVG(svg: string): string {
  if (!svg) return '';
  return DOMPurify.sanitize(svg, SVG_CONFIG) as unknown as string;
}

/**
 * Sanitize HTML content (markdown, code blocks, etc.)
 */
export function sanitizeHTML(html: string): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, HTML_CONFIG) as unknown as string;
}

/**
 * Sanitize inline style blocks
 */
export function sanitizeStyle(style: string): string {
  if (!style) return '';
  // Only allow safe CSS properties
  const sanitized = String(DOMPurify.sanitize(`<style>${style}</style>`, STYLE_CONFIG));
  // Extract style content
  const match = sanitized.match(/<style>([\s\S]*?)<\/style>/);
  return match ? match[1] : '';
}

/**
 * Check if content contains potentially dangerous patterns
 */
export function containsDangerousContent(content: string): boolean {
  if (!content) return false;

  const dangerousPatterns = [
    /<script/i,
    /javascript:/i,
    /on\w+\s*=/i,  // onclick, onload, etc.
    /data:/i,      // data: URLs can be used for XSS
    /<iframe/i,
    /<object/i,
    /<embed/i,
  ];

  return dangerousPatterns.some(pattern => pattern.test(content));
}

/**
 * Sanitize content and log warning if dangerous content was removed
 */
export function sanitizeWithWarning(content: string, type: 'svg' | 'html' = 'html'): string {
  const hadDangerousContent = containsDangerousContent(content);
  const sanitized = type === 'svg' ? sanitizeSVG(content) : sanitizeHTML(content);

  if (hadDangerousContent) {
    console.warn('[Security] Potentially dangerous content was sanitized:', {
      originalLength: content.length,
      sanitizedLength: sanitized.length,
      type,
    });
  }

  return sanitized;
}

export default {
  sanitizeSVG,
  sanitizeHTML,
  sanitizeStyle,
  containsDangerousContent,
  sanitizeWithWarning,
};
