import type { ToolIcon } from './uiState';

export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  // File operations
  read_file: 'Read',
  Read: 'Read',
  write_file: 'Write',
  Write: 'Write',
  edit_file: 'Edit',
  Edit: 'Edit',
  list_dir: 'List',
  Glob: 'Glob',
  // Shell
  bash: 'Bash',
  Bash: 'Bash',
  bash_background: 'Bash (bg)',
  // Search
  grep: 'Grep',
  Grep: 'Grep',
  find_files: 'Find',
  web_search: 'Search',
  WebSearch: 'Search',
  web_fetch: 'Fetch',
  WebFetch: 'Fetch',
  // Git
  git: 'Git',
  // MCP tools
  mcp__: 'MCP',
};

export const TOOL_ICONS: Record<string, ToolIcon> = {
  read_file: 'read',
  Read: 'read',
  write_file: 'write',
  Write: 'write',
  edit_file: 'edit',
  Edit: 'edit',
  list_dir: 'list',
  Glob: 'find',
  bash: 'bash',
  Bash: 'bash',
  bash_background: 'bash',
  grep: 'grep',
  Grep: 'grep',
  find_files: 'find',
  web_search: 'search',
  WebSearch: 'search',
  web_fetch: 'fetch',
  WebFetch: 'fetch',
  git: 'git',
};

/** Get display name for a tool. */
export function getToolDisplayName(name: string): string {
  // Check for exact match first
  if (TOOL_DISPLAY_NAMES[name]) {
    return TOOL_DISPLAY_NAMES[name];
  }
  // Check for MCP tools
  if (name.startsWith('mcp__')) {
    const parts = name.split('__');
    if (parts.length >= 3) {
      return parts[2]; // Return the actual tool name
    }
  }
  // Fallback: capitalize first letter
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Get icon type for a tool. */
export function getToolIcon(name: string): ToolIcon {
  if (TOOL_ICONS[name]) {
    return TOOL_ICONS[name];
  }
  // Check for partial matches
  if (name.includes('read')) return 'read';
  if (name.includes('write')) return 'write';
  if (name.includes('edit')) return 'edit';
  if (name.includes('bash') || name.includes('shell')) return 'bash';
  if (name.includes('search')) return 'search';
  if (name.includes('fetch')) return 'fetch';
  if (name.includes('grep')) return 'grep';
  if (name.includes('find') || name.includes('glob') || name.includes('list')) return 'find';
  if (name.includes('git')) return 'git';
  return 'default';
}

/** Generate input preview from tool input. */
export function getInputPreview(name: string, input: Record<string, unknown>): string {
  // File operations - show file path
  if (input.file_path || input.path) {
    return String(input.file_path || input.path);
  }
  // Bash - show command
  if (input.command) {
    const cmd = String(input.command);
    return cmd.length > 60 ? cmd.slice(0, 60) + '...' : cmd;
  }
  // Search - show query
  if (input.query) {
    return String(input.query);
  }
  // Pattern search
  if (input.pattern) {
    return String(input.pattern);
  }
  // URL
  if (input.url) {
    return String(input.url);
  }
  // Fallback: first string value or JSON
  const firstValue = Object.values(input).find(v => typeof v === 'string');
  if (firstValue) {
    const val = String(firstValue);
    return val.length > 60 ? val.slice(0, 60) + '...' : val;
  }
  // Last resort: JSON
  const json = JSON.stringify(input);
  return json.length > 60 ? json.slice(0, 60) + '...' : json;
}
