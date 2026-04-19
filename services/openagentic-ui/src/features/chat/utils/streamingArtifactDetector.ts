/**
 * Streaming Artifact Detector
 *
 * Detects incomplete artifact code blocks during SSE streaming.
 * Allows rendering artifacts live as they stream, rather than waiting
 * for the complete code block (with closing backticks).
 */

export type ArtifactType = 'html' | 'svg' | 'react' | 'tsx' | 'chart' | 'markdown' | 'latex' | 'csv' | 'canvas';

export interface StreamingArtifact {
  /** Whether we're currently inside an artifact code block */
  isInArtifact: boolean;
  /** The type of artifact being streamed */
  artifactType: ArtifactType | null;
  /** The partial content of the artifact (without opening fence) */
  partialContent: string;
  /** Whether the artifact has completed (has closing fence) */
  isComplete: boolean;
  /** Content before the artifact (for normal markdown rendering) */
  contentBefore: string;
  /** Content after the artifact (if complete) */
  contentAfter: string;
  /** The original language tag from the code fence */
  languageTag: string;
}

// Artifact-rendering language patterns. Case-insensitive ('i' flag) so
// LLMs that emit "Html:artifact-type" with capital H still match. The
// `:artifact-type` suffix variant is a Claude Sonnet quirk seen in the wild.
const ARTIFACT_PATTERNS = [
  /```(artifact:html|html:artifact-type|html-artifact-type|artifact-html|html|htm)\s*\n?/i,
  /```(artifact:svg|svg:artifact-type|artifact-svg|svg)\s*\n?/i,
  /```(artifact:react|react:artifact-type|artifact-react|jsx|tsx|react)\s*\n?/i,
  /```(artifact:chart|chart:artifact-type|artifact-chart|chart|chart-json)\s*\n?/i,
  /```(artifact:markdown|md:artifact-type|artifact-markdown|md)\s*\n?/i,
  /```(artifact:latex|latex:artifact-type|artifact-latex|latex|tex|math)\s*\n?/i,
  /```(artifact:csv|csv:artifact-type|artifact-csv|csv)\s*\n?/i,
  /```(artifact:canvas|canvas:artifact-type|artifact-canvas|canvas)\s*\n?/i,
];

// Map language tags to artifact types
function getArtifactType(languageTag: string): ArtifactType | null {
  const tag = languageTag.toLowerCase();

  if (tag.startsWith('artifact:')) {
    return tag.replace('artifact:', '') as ArtifactType;
  }

  // Accept "html:artifact-type" / "html-artifact-type" / "artifact-html" variants.
  if (tag.endsWith(':artifact-type') || tag.endsWith('-artifact-type')) {
    return tag.replace(/[-:]artifact-type$/, '') as ArtifactType;
  }
  if (tag.startsWith('artifact-')) {
    return tag.replace('artifact-', '') as ArtifactType;
  }

  switch (tag) {
    case 'html':
    case 'htm':
      return 'html';
    case 'svg':
      return 'svg';
    case 'jsx':
    case 'tsx':
    case 'react':
      return 'react';
    case 'chart':
    case 'chart-json':
      return 'chart';
    case 'md':
      return 'markdown';
    case 'latex':
    case 'tex':
    case 'math':
      return 'latex';
    case 'csv':
      return 'csv';
    case 'canvas':
      return 'canvas';
    default:
      return null;
  }
}

/**
 * Detect streaming artifacts in content
 *
 * @param content - The current streaming content
 * @returns StreamingArtifact with detection results
 */
export function detectStreamingArtifact(content: string): StreamingArtifact {
  const result: StreamingArtifact = {
    isInArtifact: false,
    artifactType: null,
    partialContent: '',
    isComplete: false,
    contentBefore: content,
    contentAfter: '',
    languageTag: '',
  };

  // Find any artifact-type code fence
  for (const pattern of ARTIFACT_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      const startIdx = match.index!;
      const fenceEnd = startIdx + match[0].length;
      const languageTag = match[1];
      const afterFence = content.slice(fenceEnd);

      // Check if there's a closing fence
      const closingIdx = afterFence.indexOf('```');

      result.contentBefore = content.slice(0, startIdx);
      result.languageTag = languageTag;
      result.artifactType = getArtifactType(languageTag);

      if (closingIdx !== -1) {
        // Complete artifact
        result.isInArtifact = false;
        result.isComplete = true;
        result.partialContent = afterFence.slice(0, closingIdx);
        result.contentAfter = afterFence.slice(closingIdx + 3);
      } else {
        // Incomplete artifact - still streaming
        result.isInArtifact = true;
        result.isComplete = false;
        result.partialContent = afterFence;
        result.contentAfter = '';
      }

      return result;
    }
  }

  return result;
}

/**
 * Check if content has any streaming artifact
 */
export function hasStreamingArtifact(content: string): boolean {
  return ARTIFACT_PATTERNS.some(pattern => pattern.test(content));
}

/**
 * Get minimum viable content for artifact preview
 * Some artifact types need certain structure to render at all
 */
export function getMinimumViableContent(artifactType: ArtifactType, content: string): string {
  switch (artifactType) {
    case 'html':
      // HTML can render anything
      return content;

    case 'svg':
      // SVG needs opening tag at minimum, close it if incomplete
      if (content.includes('<svg') && !content.includes('</svg>')) {
        return content + '</svg>';
      }
      return content;

    case 'react':
      // React/JSX - wrap in error boundary for partial renders
      return content;

    case 'chart':
      // JSON needs to be valid - can't partially render
      try {
        JSON.parse(content);
        return content;
      } catch {
        return '{}'; // Return empty object until valid
      }

    case 'latex':
      // LaTeX can render partial formulas
      return content;

    case 'csv':
      // CSV can render partial data
      return content;

    default:
      return content;
  }
}
