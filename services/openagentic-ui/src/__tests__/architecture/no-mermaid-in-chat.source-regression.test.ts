import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { globSync } from 'glob';
import { join, resolve } from 'path';

const SRC_ROOT = resolve(__dirname, '../..');

function readChatFiles(): Array<{ path: string; content: string }> {
  return globSync('features/chat/**/*.{ts,tsx}', { cwd: SRC_ROOT, absolute: true })
    .filter((p) => !p.includes('__tests__'))
    .filter((p) => !p.endsWith('.d.ts'))
    .map((p) => ({ path: p, content: readFileSync(p, 'utf8') }));
}

describe('no mermaid in chat UI surface', () => {
  it('no file imports MermaidRenderer', () => {
    for (const { path, content } of readChatFiles()) {
      expect(content, `${path} must not import MermaidRenderer`).not.toMatch(/import\s+.*MermaidRenderer/);
    }
  });

  it('no file imports MermaidDiagram', () => {
    for (const { path, content } of readChatFiles()) {
      expect(content, `${path} must not import MermaidDiagram`).not.toMatch(/import\s+.*MermaidDiagram/);
    }
  });

  it('SharedMarkdownRenderer does not dispatch language===mermaid to a mermaid renderer', () => {
    const f = readFileSync(
      join(SRC_ROOT, 'features/chat/components/MessageContent/SharedMarkdownRenderer.tsx'),
      'utf8',
    );
    // Forbid any dispatch that routes language==='mermaid' to a chart-style renderer.
    // Regular <pre><code> rendering is fine.
    expect(f).not.toMatch(/language\s*===\s*['"]mermaid['"]/);
    expect(f).not.toMatch(/MermaidDiagram/);
  });

  it('MermaidRenderer.tsx + MermaidDiagram.tsx files do not exist', () => {
    expect(globSync('features/chat/components/**/MermaidRenderer.tsx', { cwd: SRC_ROOT })).toHaveLength(0);
    expect(globSync('features/chat/components/**/MermaidDiagram.tsx', { cwd: SRC_ROOT })).toHaveLength(0);
  });

  it('ArtifactKind union does not include mermaid', () => {
    const f = readFileSync(
      resolve(__dirname, '../../shared/components/ArtifactPanel/types.ts'),
      'utf8',
    );
    expect(f).not.toMatch(/['"]mermaid['"]/);
  });
});
