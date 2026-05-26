import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CM_THEMES, type CmThemeId, registerCmThemes } from '../monacoThemes';

const ALL_IDS: CmThemeId[] = [
  'default',
  'catppuccin-latte',
  'catppuccin-frappe',
  'catppuccin-mocha',
  'tokyo-night',
  'dracula',
  'terminal-green',
];

describe('CM_THEMES', () => {
  it('has all 7 theme keys', () => {
    const keys = Object.keys(CM_THEMES);
    expect(keys).toHaveLength(7);
    for (const id of ALL_IDS) {
      expect(keys).toContain(id);
    }
  });

  it('each theme has base, inherit, rules, colors', () => {
    for (const id of ALL_IDS) {
      const t = CM_THEMES[id];
      expect(t.base).toBeDefined();
      expect(t.inherit).toBe(true);
      expect(Array.isArray(t.rules)).toBe(true);
      expect(typeof t.colors).toBe('object');
    }
  });

  it('catppuccin-latte uses base vs (light)', () => {
    expect(CM_THEMES['catppuccin-latte'].base).toBe('vs');
  });

  it('all dark themes use base vs-dark', () => {
    const darkIds: CmThemeId[] = [
      'default',
      'catppuccin-frappe',
      'catppuccin-mocha',
      'tokyo-night',
      'dracula',
      'terminal-green',
    ];
    for (const id of darkIds) {
      expect(CM_THEMES[id].base).toBe('vs-dark');
    }
  });

  it('each theme has token rules for comment, keyword, string, number, function', () => {
    const required = ['comment', 'keyword', 'string', 'number', 'function'];
    for (const id of ALL_IDS) {
      const tokens = CM_THEMES[id].rules.map((r: any) => r.token);
      for (const req of required) {
        expect(tokens).toContain(req);
      }
    }
  });

  it('colors include editor.background, editor.foreground, editorLineNumber.foreground', () => {
    for (const id of ALL_IDS) {
      const colors = CM_THEMES[id].colors;
      expect(colors['editor.background']).toBeDefined();
      expect(colors['editor.foreground']).toBeDefined();
      expect(colors['editorLineNumber.foreground']).toBeDefined();
    }
  });
});

describe('registerCmThemes', () => {
  let defineTheme: ReturnType<typeof vi.fn>;
  let mockMonaco: any;

  beforeEach(() => {
    defineTheme = vi.fn();
    mockMonaco = { editor: { defineTheme } };
  });

  it('calls defineTheme once per theme id, prefixed with cm-', () => {
    registerCmThemes(mockMonaco);
    expect(defineTheme).toHaveBeenCalledTimes(7);
    for (const id of ALL_IDS) {
      expect(defineTheme).toHaveBeenCalledWith(`cm-${id}`, CM_THEMES[id]);
    }
  });
});
