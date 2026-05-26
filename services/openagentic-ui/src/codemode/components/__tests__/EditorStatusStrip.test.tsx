import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditorStatusStrip } from '../EditorStatusStrip';

describe('EditorStatusStrip', () => {
  it('renders all 6 cells in order with · separators when path is set', () => {
    const { container } = render(
      <EditorStatusStrip
        path="/workspace/backend/app/main.py"
        languageLabel="python"
        cursor={{ line: 24, column: 31 }}
        sizeBytes={1400}
      />
    );
    const seps = container.querySelectorAll('.sep');
    expect(seps.length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector('.cell.path')).toBeTruthy();
  });

  it('shows last 2 path segments in path cell', () => {
    render(
      <EditorStatusStrip
        path="/workspace/backend/app/main.py"
        languageLabel="python"
        cursor={null}
        sizeBytes={0}
      />
    );
    expect(screen.getByText('app/main.py')).toBeTruthy();
  });

  it('renders No file open placeholder when path is null', () => {
    render(
      <EditorStatusStrip
        path={null}
        languageLabel=""
        cursor={null}
        sizeBytes={0}
      />
    );
    expect(screen.getByText(/no file open/i)).toBeTruthy();
  });

  it('formats 0 bytes as 0 B', () => {
    render(
      <EditorStatusStrip
        path="/a/b.ts"
        languageLabel="typescript"
        cursor={null}
        sizeBytes={0}
      />
    );
    expect(screen.getByText('0 B')).toBeTruthy();
  });

  it('formats 1500 bytes as 1.5 KB', () => {
    render(
      <EditorStatusStrip
        path="/a/b.ts"
        languageLabel="typescript"
        cursor={null}
        sizeBytes={1500}
      />
    );
    expect(screen.getByText('1.5 KB')).toBeTruthy();
  });

  it('formats 2500000 bytes as 2.4 MB', () => {
    render(
      <EditorStatusStrip
        path="/a/b.ts"
        languageLabel="typescript"
        cursor={null}
        sizeBytes={2500000}
      />
    );
    expect(screen.getByText('2.4 MB')).toBeTruthy();
  });

  it('renders download button when onDownload provided and path not null', () => {
    const handler = vi.fn();
    render(
      <EditorStatusStrip
        path="/a/b.ts"
        languageLabel="typescript"
        cursor={null}
        sizeBytes={100}
        onDownload={handler}
      />
    );
    const btn = screen.getByRole('button', { name: /download/i });
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('capitalizes language label python → Python', () => {
    render(
      <EditorStatusStrip
        path="/a/main.py"
        languageLabel="python"
        cursor={null}
        sizeBytes={100}
      />
    );
    expect(screen.getByText('Python')).toBeTruthy();
  });

  it('shows TypeScript for typescript label', () => {
    render(
      <EditorStatusStrip
        path="/a/app.ts"
        languageLabel="typescript"
        cursor={null}
        sizeBytes={100}
      />
    );
    expect(screen.getByText('TypeScript')).toBeTruthy();
  });
});
