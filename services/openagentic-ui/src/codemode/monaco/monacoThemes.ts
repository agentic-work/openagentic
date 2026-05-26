import type * as Monaco from 'monaco-editor';

export type CmThemeId =
  | 'default'
  | 'catppuccin-latte'
  | 'catppuccin-frappe'
  | 'catppuccin-mocha'
  | 'tokyo-night'
  | 'dracula'
  | 'terminal-green';

type ThemeData = Monaco.editor.IStandaloneThemeData;

// ---------------------------------------------------------------------------
// default — GitHub Dark-like (#0d1117 background)
// ---------------------------------------------------------------------------
const defaultTheme: ThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'ff7b72' },
    { token: 'string', foreground: 'a5d6ff' },
    { token: 'number', foreground: '79c0ff' },
    { token: 'type', foreground: 'ffa657' },
    { token: 'function', foreground: 'd2a8ff' },
    { token: 'variable', foreground: 'e6edf3' },
    { token: 'constant', foreground: '79c0ff' },
    { token: 'tag', foreground: '7ee787' },
    { token: 'attribute.name', foreground: 'ff7b72' },
    { token: 'attribute.value', foreground: 'a5d6ff' },
    { token: 'delimiter', foreground: 'e6edf3' },
    { token: 'regexp', foreground: 'a5d6ff' },
    { token: 'decorator', foreground: 'ffa657' },
  ],
  colors: {
    'editor.background': '#0d1117',
    'editor.foreground': '#e6edf3',
    'editorLineNumber.foreground': '#3d4554',
    'editorLineNumber.activeForeground': '#8b949e',
    'editor.selectionBackground': '#264f78',
    'editorCursor.foreground': '#79c0ff',
    'editor.lineHighlightBackground': '#161b22',
    'editorIndentGuide.background': '#21262d',
    'editorWhitespace.foreground': '#21262d',
    'scrollbar.shadow': '#010409',
    'scrollbarSlider.background': '#484f5880',
    'scrollbarSlider.hoverBackground': '#484f58B3',
    'editorWidget.background': '#161b22',
    'editorWidget.border': '#30363d',
  },
};

// ---------------------------------------------------------------------------
// dracula
// ---------------------------------------------------------------------------
const draculaTheme: ThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6272a4', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'ff79c6' },
    { token: 'string', foreground: 'f1fa8c' },
    { token: 'number', foreground: 'bd93f9' },
    { token: 'type', foreground: '8be9fd' },
    { token: 'function', foreground: '50fa7b' },
    { token: 'variable', foreground: 'f8f8f2' },
    { token: 'constant', foreground: 'bd93f9' },
    { token: 'tag', foreground: 'ff79c6' },
    { token: 'attribute.name', foreground: '50fa7b' },
    { token: 'attribute.value', foreground: 'f1fa8c' },
    { token: 'delimiter', foreground: 'f8f8f2' },
    { token: 'regexp', foreground: 'f1fa8c' },
    { token: 'decorator', foreground: 'f8f8f2' },
  ],
  colors: {
    'editor.background': '#282a36',
    'editor.foreground': '#f8f8f2',
    'editorLineNumber.foreground': '#6272a4',
    'editorLineNumber.activeForeground': '#f8f8f2',
    'editor.selectionBackground': '#44475a',
    'editorCursor.foreground': '#f8f8f0',
    'editor.lineHighlightBackground': '#44475a',
    'editorIndentGuide.background': '#3d3f4e',
    'editorWhitespace.foreground': '#3d3f4e',
    'scrollbar.shadow': '#191a21',
    'scrollbarSlider.background': '#44475a80',
    'scrollbarSlider.hoverBackground': '#44475aB3',
    'editorWidget.background': '#21222c',
    'editorWidget.border': '#6272a4',
  },
};

// ---------------------------------------------------------------------------
// tokyo-night
// ---------------------------------------------------------------------------
const tokyoNightTheme: ThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '565f89', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'bb9af7' },
    { token: 'string', foreground: '9ece6a' },
    { token: 'number', foreground: 'ff9e64' },
    { token: 'type', foreground: '7dcfff' },
    { token: 'function', foreground: '7aa2f7' },
    { token: 'variable', foreground: 'a9b1d6' },
    { token: 'constant', foreground: 'ff9e64' },
    { token: 'tag', foreground: 'f7768e' },
    { token: 'attribute.name', foreground: '73daca' },
    { token: 'attribute.value', foreground: '9ece6a' },
    { token: 'delimiter', foreground: 'a9b1d6' },
    { token: 'regexp', foreground: 'b4f9f8' },
    { token: 'decorator', foreground: 'ff9e64' },
  ],
  colors: {
    'editor.background': '#1a1b26',
    'editor.foreground': '#a9b1d6',
    'editorLineNumber.foreground': '#3b3d57',
    'editorLineNumber.activeForeground': '#737aa2',
    'editor.selectionBackground': '#283457',
    'editorCursor.foreground': '#c0caf5',
    'editor.lineHighlightBackground': '#1f2335',
    'editorIndentGuide.background': '#292e42',
    'editorWhitespace.foreground': '#292e42',
    'scrollbar.shadow': '#15161e',
    'scrollbarSlider.background': '#28345780',
    'scrollbarSlider.hoverBackground': '#283457B3',
    'editorWidget.background': '#1f2335',
    'editorWidget.border': '#292e42',
  },
};

// ---------------------------------------------------------------------------
// catppuccin-mocha (dark)
// ---------------------------------------------------------------------------
const catppuccinMochaTheme: ThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6c7086', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'cba6f7' },
    { token: 'string', foreground: 'a6e3a1' },
    { token: 'number', foreground: 'fab387' },
    { token: 'type', foreground: 'f9e2af' },
    { token: 'function', foreground: '89b4fa' },
    { token: 'variable', foreground: 'cdd6f4' },
    { token: 'constant', foreground: 'fab387' },
    { token: 'tag', foreground: 'f38ba8' },
    { token: 'attribute.name', foreground: '94e2d5' },
    { token: 'attribute.value', foreground: 'a6e3a1' },
    { token: 'delimiter', foreground: 'cdd6f4' },
    { token: 'regexp', foreground: 'f5c2e7' },
    { token: 'decorator', foreground: 'fab387' },
  ],
  colors: {
    'editor.background': '#1e1e2e',
    'editor.foreground': '#cdd6f4',
    'editorLineNumber.foreground': '#45475a',
    'editorLineNumber.activeForeground': '#7f849c',
    'editor.selectionBackground': '#585b7080',
    'editorCursor.foreground': '#f5e0dc',
    'editor.lineHighlightBackground': '#313244',
    'editorIndentGuide.background': '#313244',
    'editorWhitespace.foreground': '#313244',
    'scrollbar.shadow': '#181825',
    'scrollbarSlider.background': '#58587080',
    'scrollbarSlider.hoverBackground': '#585870B3',
    'editorWidget.background': '#181825',
    'editorWidget.border': '#45475a',
  },
};

// ---------------------------------------------------------------------------
// catppuccin-frappe (dark, lighter than mocha)
// ---------------------------------------------------------------------------
const catppuccinFrappeTheme: ThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '737994', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'ca9ee6' },
    { token: 'string', foreground: 'a6d189' },
    { token: 'number', foreground: 'ef9f76' },
    { token: 'type', foreground: 'e5c890' },
    { token: 'function', foreground: '8caaee' },
    { token: 'variable', foreground: 'c6d0f5' },
    { token: 'constant', foreground: 'ef9f76' },
    { token: 'tag', foreground: 'e78284' },
    { token: 'attribute.name', foreground: '81c8be' },
    { token: 'attribute.value', foreground: 'a6d189' },
    { token: 'delimiter', foreground: 'c6d0f5' },
    { token: 'regexp', foreground: 'f4b8e4' },
    { token: 'decorator', foreground: 'ef9f76' },
  ],
  colors: {
    'editor.background': '#303446',
    'editor.foreground': '#c6d0f5',
    'editorLineNumber.foreground': '#51576d',
    'editorLineNumber.activeForeground': '#838ba7',
    'editor.selectionBackground': '#626880',
    'editorCursor.foreground': '#f2d5cf',
    'editor.lineHighlightBackground': '#414559',
    'editorIndentGuide.background': '#414559',
    'editorWhitespace.foreground': '#414559',
    'scrollbar.shadow': '#232634',
    'scrollbarSlider.background': '#62688080',
    'scrollbarSlider.hoverBackground': '#626880B3',
    'editorWidget.background': '#232634',
    'editorWidget.border': '#51576d',
  },
};

// ---------------------------------------------------------------------------
// catppuccin-latte (LIGHT)
// ---------------------------------------------------------------------------
const catppuccinLatteTheme: ThemeData = {
  base: 'vs',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '9ca0b0', fontStyle: 'italic' },
    { token: 'keyword', foreground: '8839ef' },
    { token: 'string', foreground: '40a02b' },
    { token: 'number', foreground: 'fe640b' },
    { token: 'type', foreground: 'df8e1d' },
    { token: 'function', foreground: '1e66f5' },
    { token: 'variable', foreground: '4c4f69' },
    { token: 'constant', foreground: 'fe640b' },
    { token: 'tag', foreground: 'd20f39' },
    { token: 'attribute.name', foreground: '179299' },
    { token: 'attribute.value', foreground: '40a02b' },
    { token: 'delimiter', foreground: '4c4f69' },
    { token: 'regexp', foreground: 'ea76cb' },
    { token: 'decorator', foreground: 'fe640b' },
  ],
  colors: {
    'editor.background': '#eff1f5',
    'editor.foreground': '#4c4f69',
    'editorLineNumber.foreground': '#8c8fa1',
    'editorLineNumber.activeForeground': '#4c4f69',
    'editor.selectionBackground': '#acb0be',
    'editorCursor.foreground': '#dc8a78',
    'editor.lineHighlightBackground': '#e6e9ef',
    'editorIndentGuide.background': '#ccd0da',
    'editorWhitespace.foreground': '#ccd0da',
    'scrollbar.shadow': '#dce0e8',
    'scrollbarSlider.background': '#acb0be80',
    'scrollbarSlider.hoverBackground': '#acb0beB3',
    'editorWidget.background': '#e6e9ef',
    'editorWidget.border': '#bcc0cc',
  },
};

// ---------------------------------------------------------------------------
// terminal-green
// ---------------------------------------------------------------------------
const terminalGreenTheme: ThemeData = {
  base: 'vs-dark',
  inherit: true,
  rules: [
    { token: 'comment', foreground: '1a8c1a', fontStyle: 'italic' },
    { token: 'keyword', foreground: '00ff00', fontStyle: 'bold' },
    { token: 'string', foreground: '33cc33' },
    { token: 'number', foreground: '66ff66' },
    { token: 'type', foreground: '00cc00' },
    { token: 'function', foreground: '00ff00' },
    { token: 'variable', foreground: '33ff33' },
    { token: 'constant', foreground: '66ff66' },
    { token: 'tag', foreground: '00ff00' },
    { token: 'attribute.name', foreground: '33cc33' },
    { token: 'attribute.value', foreground: '66ff66' },
    { token: 'delimiter', foreground: '33ff33' },
    { token: 'regexp', foreground: '00cc00' },
    { token: 'decorator', foreground: '66ff66' },
  ],
  colors: {
    'editor.background': '#000000',
    'editor.foreground': '#33ff33',
    'editorLineNumber.foreground': '#1a6b1a',
    'editorLineNumber.activeForeground': '#33ff33',
    'editor.selectionBackground': '#003300',
    'editorCursor.foreground': '#00ff00',
    'editor.lineHighlightBackground': '#001a00',
    'editorIndentGuide.background': '#1a3300',
    'editorWhitespace.foreground': '#1a3300',
    'scrollbar.shadow': '#000000',
    'scrollbarSlider.background': '#00330080',
    'scrollbarSlider.hoverBackground': '#003300B3',
    'editorWidget.background': '#001a00',
    'editorWidget.border': '#1a6b1a',
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
export const CM_THEMES: Record<CmThemeId, ThemeData> = {
  'default': defaultTheme,
  'dracula': draculaTheme,
  'tokyo-night': tokyoNightTheme,
  'catppuccin-mocha': catppuccinMochaTheme,
  'catppuccin-frappe': catppuccinFrappeTheme,
  'catppuccin-latte': catppuccinLatteTheme,
  'terminal-green': terminalGreenTheme,
};

/** Register all 7 cm-* themes on the Monaco instance. */
export function registerCmThemes(monaco: { editor: { defineTheme: (name: string, theme: ThemeData) => void } }): void {
  for (const [id, theme] of Object.entries(CM_THEMES) as [CmThemeId, ThemeData][]) {
    monaco.editor.defineTheme(`cm-${id}`, theme);
  }
}
