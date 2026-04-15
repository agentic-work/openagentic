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

import React from 'react';
import {
  Cpu,
  Folder,
  Coins,
  ArrowUpRight,
  ArrowDownRight,
  ExternalLink,
  Maximize2,
} from '@/shared/icons';
import {
  useCodeModeStore,
  useSession,
  useTotalInputTokens,
  useTotalOutputTokens,
} from '@/stores/useCodeModeStore';
import clsx from 'clsx';

interface TerminalHeaderBarProps {
  sessionId?: string | null;
  themeSlot?: React.ReactNode;
  className?: string;
}

function formatTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

function formatWorkspace(path: string | undefined): string {
  if (!path) return '/workspace';
  if (path.length <= 28) return path;
  return '…' + path.slice(-26);
}

function formatModel(model: string | undefined): string {
  if (!model) return 'unknown';
  if (!model.includes('.') && !model.includes(':') && model.length <= 16) {
    return model;
  }
  const match = model.match(/(sonnet|opus|haiku|gemini|gpt-?\d|qwen|llama|mistral)/i);
  if (match) return match[1].toLowerCase();
  const tail = model.split(/[./:]/).filter(Boolean).pop() ?? model;
  return tail.length > 16 ? tail.slice(0, 14) + '…' : tail;
}

interface ChipProps {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
  title?: string;
  tone?: 'default' | 'accent' | 'muted';
}

const Chip: React.FC<ChipProps> = ({ icon, label, value, title, tone = 'default' }) => (
  <div
    className={clsx(
      'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs whitespace-nowrap',
      'border transition-colors duration-150',
      tone === 'accent' &&
        'bg-[var(--cm-accent,var(--color-primary))]/10 border-[var(--cm-accent,var(--color-primary))]/30 text-[var(--cm-accent,var(--color-primary))]',
      tone === 'muted' &&
        'bg-transparent border-transparent text-[var(--cm-text-muted,var(--color-textMuted))]',
      tone === 'default' &&
        'bg-[var(--color-surfaceSecondary,var(--color-surface))] border-[var(--color-border)] text-[var(--color-text)]',
    )}
    title={title}
  >
    {icon}
    <span className="opacity-60 font-medium">{label}</span>
    <span className="font-mono">{value}</span>
  </div>
);

export const TerminalHeaderBar: React.FC<TerminalHeaderBarProps> = ({
  sessionId,
  themeSlot,
  className,
}) => {
  const session = useSession();
  const inTokens = useTotalInputTokens();
  const outTokens = useTotalOutputTokens();

  if (!sessionId || !session) {
    return (
      <div
        className={clsx(
          'relative z-30 flex flex-shrink-0 items-center gap-2 px-3 py-1.5 border-b',
          className,
        )}
        style={{ borderColor: 'var(--color-border)' }}
      >
        {themeSlot}
        <span className="text-xs text-[var(--cm-text-muted,var(--color-textMuted))]">
          waiting for session…
        </span>
      </div>
    );
  }

  const handleOpenExternal = () => {
    // Open terminal in a focused new window — append ?terminal-focus=1 so
    // CodeModeLayoutV2 can detect it and hide sidebars/editor for a
    // full-viewport terminal experience (like code-server's pop-out).
    const url = new URL(window.location.href);
    url.pathname = '/code';
    url.searchParams.set('terminal-focus', '1');
    window.open(url.toString(), '_blank');
  };

  const handleFitToScreen = () => {
    // Force a clean resize + font repick + full repaint. TerminalPanel
    // registers this handler on mount; calling it bypasses the settling
    // lock and re-runs applyFontSizeAndFit as if the user had just
    // settled a splitter drag. End state: openagentic re-renders into
    // the current container dims, same as `stty cols N rows M; clear`.
    useCodeModeStore.getState().forceTerminalRefit?.();
  };

  return (
    <div
      className={clsx(
        'relative z-30 flex flex-shrink-0 items-center gap-2 px-3 py-1 border-b min-w-0',
        className,
      )}
      style={{ borderColor: 'var(--color-border)' }}
    >
      {themeSlot}
      <div className="flex-1" />
      <button
        onClick={handleFitToScreen}
        className="p-1.5 rounded hover:bg-[var(--cm-bg-tertiary,var(--color-surfaceSecondary))] text-[var(--cm-text-secondary,var(--color-textMuted))]"
        title="Fit to Screen — re-scale terminal to current panel size"
      >
        <Maximize2 size={14} />
      </button>
      <button
        onClick={handleOpenExternal}
        className="p-1.5 rounded hover:bg-[var(--cm-bg-tertiary,var(--color-surfaceSecondary))] text-[var(--cm-text-secondary,var(--color-textMuted))]"
        title="Open in New Window"
      >
        <ExternalLink size={14} />
      </button>
    </div>
  );
};

export default TerminalHeaderBar;
