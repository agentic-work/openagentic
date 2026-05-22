/**
 * Sev-0 #930 — Sub-agent output inside SubAgentCard's `cm-sa-return` strip
 * must render through SharedMarkdownRenderer so `**bold**`, `# heading`,
 * fenced code, lists, links, and tables come out semantic.
 *
 * Smoking gun (dev Playwright probe, 2026-05-17): cloud_operations
 * sub-agent's body arrived in the dark-green return strip as literal
 * markdown text — `**bold**` showed two-asterisk pairs, fenced code
 * showed triple-backticks, headings showed `#`. The text was being
 * dropped into a plain `<span>{output}</span>` instead of the
 * `<SharedMarkdownRenderer content={output} />` the main chat agent
 * uses for all assistant prose.
 *
 * Fix: route the `output` (and the legacy `returnValue` fallback) string
 * through SharedMarkdownRenderer — the SAME component AgenticActivityStream
 * uses at AAS:3276-3280, with the SAME theme-token CSS so colours resolve
 * via `var(--cm-*)` per CLAUDE.md Rule 8(b).
 *
 * Both render paths (streaming `output` from useChatStream + persisted
 * `output` from mergePersistedSubAgents) feed the same string into the
 * same SubAgentCard, so a single fix point closes both.
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';

// Same mocks the SharedMarkdownRenderer test suite uses — code-block
// renderers depend on Shiki WASM which doesn't work in jsdom.
vi.mock('../../MessageContent/EnhancedShikiCodeBlock', () => ({ default: ({ code }: { code: string }) => <pre><code>{code}</code></pre> }));
vi.mock('../../MessageContent/ShikiCodeBlock', () => ({ default: ({ code }: { code: string }) => <pre><code>{code}</code></pre> }));
vi.mock('../../MessageContent/EnhancedCodeBlock', () => ({ default: ({ code }: { code: string }) => <pre><code>{code}</code></pre> }));
vi.mock('../../MessageContent/ChartRenderer', () => ({ default: () => null }));

import { SubAgentCard } from '../SubAgentCard';

describe('SubAgentCard #930 — output renders through SharedMarkdownRenderer', () => {
  it('parses **bold** markdown in output into a <strong> element', () => {
    const { container } = render(
      <SubAgentCard
        name="Cloud Operations"
        role="cloud_operations"
        variant="c"
        status="ok"
        output="The sub-agent found **23 idle VMs** across 6 subs."
      />,
    );
    const ret = container.querySelector('.cm-sa-return');
    expect(ret).not.toBeNull();
    // Scope to the rendered body — the cm-sa-return div also has a
    // chrome <strong>returned</strong> label that we must NOT confuse
    // with the markdown-parsed bold.
    const body = ret!.querySelector('.cm-sa-return-body');
    expect(body).not.toBeNull();
    const strong = body!.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('23 idle VMs');
    // Literal asterisks must NOT survive into the DOM as text.
    expect(body!.textContent).not.toContain('**');
  });

  it('parses # heading markdown in output into an <h1> element', () => {
    const { container } = render(
      <SubAgentCard
        name="Cloud Operations"
        role="cloud_operations"
        variant="c"
        status="ok"
        output={'# Cost analysis summary\n\nFound 6 resource groups.'}
      />,
    );
    const ret = container.querySelector('.cm-sa-return');
    expect(ret).not.toBeNull();
    const h1 = ret!.querySelector('h1');
    expect(h1).not.toBeNull();
    expect(h1?.textContent).toBe('Cost analysis summary');
  });

  it('parses fenced code in output into a <pre><code> block', () => {
    const fenced = '```bash\naz vm list --query "[].name"\n```';
    const { container } = render(
      <SubAgentCard
        name="Cloud Operations"
        role="cloud_operations"
        variant="c"
        status="ok"
        output={fenced}
      />,
    );
    const ret = container.querySelector('.cm-sa-return');
    expect(ret).not.toBeNull();
    const pre = ret!.querySelector('pre');
    expect(pre).not.toBeNull();
    const code = pre!.querySelector('code');
    expect(code).not.toBeNull();
    expect(code?.textContent).toContain('az vm list');
    // Triple-backticks must not survive into the DOM as text.
    expect(ret!.textContent).not.toContain('```');
  });

  it('parses inline link [text](url) markdown into an <a> element', () => {
    const { container } = render(
      <SubAgentCard
        name="Cloud Operations"
        role="cloud_operations"
        variant="c"
        status="ok"
        output="See [the Azure docs](https://learn.microsoft.com/azure) for details."
      />,
    );
    const ret = container.querySelector('.cm-sa-return');
    expect(ret).not.toBeNull();
    const a = ret!.querySelector('a');
    expect(a).not.toBeNull();
    expect(a?.getAttribute('href')).toBe('https://learn.microsoft.com/azure');
    expect(a?.textContent).toBe('the Azure docs');
  });

  it('falls back to returnValue and ALSO parses it as markdown when output is absent', () => {
    const { container } = render(
      <SubAgentCard
        name="x"
        role="x"
        variant="c"
        status="ok"
        returnValue="Saved **$1,361,869** per quarter"
      />,
    );
    const ret = container.querySelector('.cm-sa-return');
    expect(ret).not.toBeNull();
    const body = ret!.querySelector('.cm-sa-return-body');
    expect(body).not.toBeNull();
    const strong = body!.querySelector('strong');
    expect(strong).not.toBeNull();
    expect(strong?.textContent).toBe('$1,361,869');
    expect(body!.textContent).not.toContain('**');
  });
});
