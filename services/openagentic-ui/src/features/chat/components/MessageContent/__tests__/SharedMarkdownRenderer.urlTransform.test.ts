/**
 * Regression: the admin AI agent emits `[Open <label>](#<slug>)` deep-link
 * tokens that AdminAI.tsx intercepts at click-capture time, dispatching a
 * `openagentic-admin:navigate` window event so the shell switches sections
 * without a real browser navigation.
 *
 * Before this fix, the `urlTransform` URL-allowlist only accepted
 * `http://`, `https://`, `/`, `image://`, and `data:` — so a hash-anchor
 * href like `#model-management` was rewritten to the empty string. With
 * `href=""` the rendered anchor resolves to the current page URL, and a
 * click reloads the app at its root (e.g. `/admin`), which the user
 * reported as "links still open the main page again."
 *
 * Contract: the URL transform must preserve hash-only hrefs (the canonical
 * deep-link form for the admin agent) AND mailto: addresses (so plain
 * email links in agent answers don't get nuked either).
 */
import { describe, it, expect } from 'vitest';
import { urlTransform } from '../SharedMarkdownRenderer';

describe('SharedMarkdownRenderer urlTransform', () => {
  it('preserves hash-anchor hrefs (admin agent deep-link form)', () => {
    expect(urlTransform('#model-management')).toBe('#model-management');
    expect(urlTransform('#tiered-fc')).toBe('#tiered-fc');
  });

  it('preserves mailto: hrefs', () => {
    expect(urlTransform('mailto:trent@openagentic.io')).toBe('mailto:trent@openagentic.io');
  });

  it('still allows the existing safe protocols', () => {
    expect(urlTransform('https://example.com')).toBe('https://example.com');
    expect(urlTransform('http://example.com')).toBe('http://example.com');
    expect(urlTransform('/admin/dashboard')).toBe('/admin/dashboard');
    expect(urlTransform('image://abc123')).toBe('image://abc123');
    expect(urlTransform('data:image/png;base64,XXXX')).toBe('data:image/png;base64,XXXX');
  });

  it('still blocks dangerous protocols', () => {
    expect(urlTransform('javascript:alert(1)')).toBe('');
    expect(urlTransform('vbscript:msgbox(1)')).toBe('');
    expect(urlTransform('file:///etc/passwd')).toBe('');
  });
});
