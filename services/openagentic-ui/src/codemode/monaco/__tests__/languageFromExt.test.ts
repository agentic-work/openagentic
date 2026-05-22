import { describe, it, expect } from 'vitest';
import { languageFromExt } from '../languageFromExt';

describe('languageFromExt', () => {
  it('maps .ts to typescript', () => {
    expect(languageFromExt('foo.ts')).toBe('typescript');
  });

  it('maps .tsx to typescript', () => {
    expect(languageFromExt('Component.tsx')).toBe('typescript');
  });

  it('maps .py to python', () => {
    expect(languageFromExt('main.py')).toBe('python');
  });

  it('maps Dockerfile (no extension) to dockerfile', () => {
    expect(languageFromExt('Dockerfile')).toBe('dockerfile');
  });

  it('maps .md to markdown', () => {
    expect(languageFromExt('README.md')).toBe('markdown');
  });

  it('returns plaintext for unknown extension', () => {
    expect(languageFromExt('archive.xyz')).toBe('plaintext');
  });

  it('returns plaintext when no extension', () => {
    expect(languageFromExt('Makefile')).toBe('plaintext');
  });

  it('is case-insensitive for .TS', () => {
    expect(languageFromExt('APP.TS')).toBe('typescript');
  });
});
