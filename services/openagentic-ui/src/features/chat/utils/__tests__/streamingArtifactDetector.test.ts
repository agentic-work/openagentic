/**
 * Tests for streamingArtifactDetector.
 *
 * This module is the entry point for live-artifact previews during
 * streaming. Bugs here manifest as either (a) artifacts never picked up
 * from a partial stream, (b) deprecated fences (mermaid) sneaking into
 * the pipeline, or (c) the wrong slice of the stream going to the
 * StreamingArtifactRenderer.
 */

import { describe, it, expect } from 'vitest';
import {
  detectStreamingArtifact,
  hasStreamingArtifact,
  getMinimumViableContent,
  type ArtifactType,
} from '../streamingArtifactDetector';

describe('detectStreamingArtifact', () => {
  it('returns the defaulted empty result when no fence is present', () => {
    const out = detectStreamingArtifact('just some prose, no code fence here');
    expect(out.isInArtifact).toBe(false);
    expect(out.artifactType).toBeNull();
    expect(out.isComplete).toBe(false);
    expect(out.contentBefore).toBe('just some prose, no code fence here');
    expect(out.contentAfter).toBe('');
  });

  it('recognizes an in-progress html fence and buckets the partial content', () => {
    const stream = 'intro\n```html\n<div>par';
    const out = detectStreamingArtifact(stream);
    expect(out.isInArtifact).toBe(true);
    expect(out.isComplete).toBe(false);
    expect(out.artifactType).toBe('html');
    expect(out.contentBefore).toBe('intro\n');
    expect(out.partialContent).toBe('<div>par');
  });

  it('recognizes a completed svg fence and splits before / after', () => {
    const stream = 'before\n```svg\n<svg/>\n```\nafter';
    const out = detectStreamingArtifact(stream);
    expect(out.isComplete).toBe(true);
    expect(out.isInArtifact).toBe(false);
    expect(out.artifactType).toBe('svg');
    expect(out.contentBefore).toBe('before\n');
    expect(out.partialContent.includes('<svg/>')).toBe(true);
    expect(out.contentAfter).toBe('\nafter');
  });

  it('treats the Claude "html:artifact-type" quirk as html', () => {
    const out = detectStreamingArtifact('```html:artifact-type\n<div/>');
    expect(out.artifactType).toBe('html');
  });

  it('recognizes explicit artifact:react fence', () => {
    const out = detectStreamingArtifact('```artifact:react\nfunction App(){}');
    expect(out.artifactType).toBe('react');
  });

  it('does NOT recognize mermaid as a streaming artifact (Phase G deprecation)', () => {
    // The detector must not hand Mermaid content to StreamingArtifactRenderer;
    // it has no mermaid template and would render a blank iframe.
    const stream = '```mermaid\ngraph TD\nA-->B\n```';
    expect(hasStreamingArtifact(stream)).toBe(false);
    const out = detectStreamingArtifact(stream);
    expect(out.isInArtifact).toBe(false);
    expect(out.artifactType).toBeNull();
  });
});

describe('hasStreamingArtifact', () => {
  it('is true for any known artifact fence', () => {
    expect(hasStreamingArtifact('```html\n<b/>')).toBe(true);
    expect(hasStreamingArtifact('```artifact:chart\n{}')).toBe(true);
    expect(hasStreamingArtifact('```svg\n<svg/>')).toBe(true);
  });

  it('is false for plain code fences or prose', () => {
    expect(hasStreamingArtifact('```python\nprint(1)\n```')).toBe(false);
    expect(hasStreamingArtifact('no fence at all')).toBe(false);
  });
});

describe('getMinimumViableContent', () => {
  it('passes html through unchanged', () => {
    expect(getMinimumViableContent('html', '<div')).toBe('<div');
  });

  it('auto-closes an unterminated <svg> tag so the iframe can render', () => {
    const closed = getMinimumViableContent('svg', '<svg width="10"');
    expect(closed.endsWith('</svg>')).toBe(true);
  });

  it('does not double-close a completed <svg>', () => {
    const source = '<svg><rect/></svg>';
    expect(getMinimumViableContent('svg', source)).toBe(source);
  });

  it('returns "{}" when chart JSON is mid-stream / invalid', () => {
    expect(getMinimumViableContent('chart', '{"type":')).toBe('{}');
  });

  it('returns the full JSON once it parses', () => {
    const spec = '{"type":"bar"}';
    expect(getMinimumViableContent('chart', spec)).toBe(spec);
  });

  it('csv / latex / react pass through verbatim', () => {
    expect(getMinimumViableContent('csv', 'a,b\n1,2')).toBe('a,b\n1,2');
    expect(getMinimumViableContent('latex', '\\frac')).toBe('\\frac');
    expect(getMinimumViableContent('react', 'fn(){}' as string)).toBe('fn(){}');
  });

  it('unknown type falls through to verbatim passthrough (defensive)', () => {
    const unknown = 'weird-type' as unknown as ArtifactType;
    expect(getMinimumViableContent(unknown, 'payload')).toBe('payload');
  });
});
