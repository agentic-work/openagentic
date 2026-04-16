/**
 * Coding CLI adapter registry.
 *
 * Defines the set of coding CLIs the exec sandbox supports, how to invoke
 * each one, and which env vars each expects for authentication. Admins pick
 * a default from the admin panel; users can override per-session.
 */

export type CodingAdapterId =
  | 'claude-code'
  | 'gemini-cli'
  | 'aider'
  | 'opencode'
  | 'open-interpreter'
  | 'cursor-cli'
  | 'none';

export interface CodingAdapter {
  id: CodingAdapterId;
  label: string;
  bin: string;                    // command to invoke inside the sandbox
  installHint: string;             // shell one-liner to install if not present
  envVars: string[];               // env vars the CLI reads for auth
  bundled: boolean;                // pre-installed in the exec image
  description: string;
}

export const CODING_ADAPTERS: Record<CodingAdapterId, CodingAdapter> = {
  'claude-code': {
    id: 'claude-code',
    label: 'Claude Code',
    bin: 'claude',
    installHint: 'npm install -g @anthropic-ai/claude-code',
    envVars: ['ANTHROPIC_API_KEY'],
    bundled: true,
    description: "Anthropic's official CLI. Requires an ANTHROPIC_API_KEY.",
  },
  'gemini-cli': {
    id: 'gemini-cli',
    label: 'Gemini CLI',
    bin: 'gemini',
    installHint: 'npm install -g @google/gemini-cli',
    envVars: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY'],
    bundled: true,
    description: "Google's Gemini CLI. Requires a GEMINI_API_KEY.",
  },
  'aider': {
    id: 'aider',
    label: 'Aider',
    bin: 'aider',
    installHint: 'pip install aider-chat',
    envVars: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
    bundled: false,
    description: 'Pair-programming CLI. Uses whichever provider key you set.',
  },
  'opencode': {
    id: 'opencode',
    label: 'OpenCode',
    bin: 'opencode',
    installHint: 'npm install -g @opencoders/opencode',
    envVars: ['OPENCODE_API_KEY', 'ANTHROPIC_API_KEY'],
    bundled: false,
    description: 'Open-source coding CLI.',
  },
  'open-interpreter': {
    id: 'open-interpreter',
    label: 'Open Interpreter',
    bin: 'interpreter',
    installHint: 'pip install open-interpreter',
    envVars: ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'],
    bundled: false,
    description: 'Natural-language code execution.',
  },
  'cursor-cli': {
    id: 'cursor-cli',
    label: 'Cursor CLI',
    bin: 'cursor',
    installHint: 'curl -fsSL https://cursor.com/install.sh | sh',
    envVars: ['CURSOR_API_KEY'],
    bundled: false,
    description: "Cursor's CLI (when available).",
  },
  'none': {
    id: 'none',
    label: 'None (bare terminal)',
    bin: 'bash',
    installHint: '',
    envVars: [],
    bundled: true,
    description: 'No CLI. Users open a plain shell in the sandbox.',
  },
};

export function listAdapters(): CodingAdapter[] {
  return Object.values(CODING_ADAPTERS);
}

export function getAdapter(id: string): CodingAdapter | undefined {
  return CODING_ADAPTERS[id as CodingAdapterId];
}
