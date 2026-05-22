/** Map a file path / basename to a Monaco language id. */
const EXT_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  json: 'json',
  py: 'python',
  md: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  html: 'html',
  css: 'css',
  scss: 'css',
  sh: 'shell',
  bash: 'shell',
  go: 'go',
  rs: 'rust',
  svg: 'xml',
  sql: 'sql',
  dockerfile: 'dockerfile',
};

const EXACT_NAMES: Record<string, string> = {
  Dockerfile: 'dockerfile',
};

/** Return Monaco language id for a file path/basename. */
export function languageFromExt(filePath: string): string {
  const basename = filePath.split('/').pop() ?? filePath;

  if (EXACT_NAMES[basename]) {
    return EXACT_NAMES[basename];
  }

  const dotIdx = basename.lastIndexOf('.');
  if (dotIdx === -1) return 'plaintext';

  const ext = basename.slice(dotIdx + 1).toLowerCase();
  return EXT_MAP[ext] ?? 'plaintext';
}

/** Human-friendly display names for language ids used in the status strip. */
const LANGUAGE_LABELS: Record<string, string> = {
  typescript: 'TypeScript',
  javascript: 'JavaScript',
  json: 'JSON',
  python: 'Python',
  markdown: 'Markdown',
  yaml: 'YAML',
  ini: 'TOML',
  html: 'HTML',
  css: 'CSS',
  shell: 'Shell',
  go: 'Go',
  rust: 'Rust',
  xml: 'XML',
  sql: 'SQL',
  dockerfile: 'Dockerfile',
  plaintext: 'Plain Text',
};

/** Convert a Monaco language id to a human-friendly label. */
export function languageLabel(langId: string): string {
  return (
    LANGUAGE_LABELS[langId] ??
    langId.charAt(0).toUpperCase() + langId.slice(1)
  );
}
