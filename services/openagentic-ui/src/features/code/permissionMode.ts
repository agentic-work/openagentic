/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export type PermissionMode =
  | 'default'
  | 'acceptEdits'
  | 'plan'
  | 'bypassPermissions';

export interface PermissionModeConfig {
  id: PermissionMode;
  /** Full title shown in help / tooltips. */
  title: string;
  /** Short label shown in the compact footer pill. */
  shortTitle: string;
  /** Leading glyph — matches openagentic figures. Empty for default. */
  symbol: string;
  /** Hex color matching the terminal theme. */
  color: string;
  /** CSS background for the pill — a tinted wash of `color`. */
  background: string;
}

/**
 * Verified against a live PTY capture of openagentic v0.6.2 at
 * /tmp/openagentic-ref/boot3.raw — the bypassPermissions footer line
 * reads exactly: `⏵⏵ permissive on (shift+tab to cycle)`. Other modes
 * follow the same pattern with their own symbol/title. Labels are
 * lowercase in the footer even though the config uses TitleCase.
 */
export const PERMISSION_MODE_CONFIG: Record<PermissionMode, PermissionModeConfig> = {
  default: {
    id: 'default',
    title: 'Default',
    shortTitle: 'default',
    symbol: '',
    color: 'var(--cm-text, #e6edf3)',
    background: 'rgba(110, 118, 129, 0.18)',
  },
  acceptEdits: {
    id: 'acceptEdits',
    title: 'Accept edits',
    shortTitle: 'accept edits',
    symbol: '⏵⏵',
    color: 'var(--cm-success, #3fb950)',
    background: 'rgba(63, 185, 80, 0.15)',
  },
  plan: {
    id: 'plan',
    // "Plan Mode" — verified against live PTY capture. Symbol is ⏸
    // (PAUSE_ICON). Color is ANSI 256 color 73 (~#5faec1, a soft
    // teal/blue), captured from the raw SGR escape in boot3.raw.
    title: 'Plan Mode',
    shortTitle: 'plan mode',
    symbol: '⏸',
    color: '#5faec1',
    background: 'rgba(95, 174, 193, 0.18)',
  },
  bypassPermissions: {
    id: 'bypassPermissions',
    // Openagentic user-visible label is "Permissive" — the internal id
    // stays `bypassPermissions` for schema / protocol compatibility.
    title: 'Permissive',
    shortTitle: 'permissive',
    symbol: '⏵⏵',
    color: 'var(--cm-error, #f85149)',
    background: 'rgba(248, 81, 73, 0.15)',
  },
};

/**
 * Renders the footer hint string the TUI shows below the input box.
 * Exact format from the captured reference:
 *   bypassPermissions → `⏵⏵ permissive on (shift+tab to cycle)`
 *   default           → `default (shift+tab to cycle)`  (no "on" suffix)
 * Openagentic appends "on" only to explicitly-enabled non-default modes.
 */
export function formatFooterModeLine(mode: PermissionMode): string {
  const cfg = PERMISSION_MODE_CONFIG[mode];
  if (mode === 'default') {
    return `default (shift+tab to cycle)`;
  }
  const symbolPart = cfg.symbol ? `${cfg.symbol} ` : '';
  return `${symbolPart}${cfg.shortTitle} on (shift+tab to cycle)`;
}

/**
 * Cycle order used by Shift+Tab, matching openagentic/src/utils/permissions/getNextPermissionMode.ts
 * for the non-internal-user branch (the one typical users see).
 */
export const PERMISSION_MODE_CYCLE: PermissionMode[] = [
  'default',
  'acceptEdits',
  'plan',
  'bypassPermissions',
];

export function getNextPermissionMode(current: PermissionMode): PermissionMode {
  const idx = PERMISSION_MODE_CYCLE.indexOf(current);
  if (idx < 0) return 'default';
  return PERMISSION_MODE_CYCLE[(idx + 1) % PERMISSION_MODE_CYCLE.length];
}

/**
 * Converts a UI permission mode to the exec daemon / openagentic CLI
 * flag. openagentic accepts `--permission-mode <value>` with values from
 * PERMISSION_MODES; for `bypassPermissions` the equivalent convenience
 * flag is `--permissive` which we keep using so the existing sandbox
 * behavior is unchanged.
 */
export function permissionModeToCliFlags(mode: PermissionMode): string[] {
  if (mode === 'bypassPermissions') return ['--permissive'];
  return ['--permission-mode', mode];
}
