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
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, Brain, Wrench, Sparkles } from '@/shared/icons';
import { useActivityState, useActivityMessage } from '@/stores/useCodeModeStore';
import type { ActivityState } from '@/stores/useCodeModeStore';
import clsx from 'clsx';

interface TerminalActivityOverlayProps {
  className?: string;
}

interface ActivityChipConfig {
  icon: React.ReactNode;
  tone: string;
  label: string;
  pulse: boolean;
}

/**
 * Map an ActivityState to its visual treatment. Idle returns null so the
 * overlay disappears entirely. The colors lean on the existing CodeMode
 * theme variables so they stay consistent across light/dark/themed
 * variants.
 */
function configForState(state: ActivityState, msg: string | null): ActivityChipConfig | null {
  switch (state) {
    case 'idle':
    case 'complete':
      return null;
    case 'thinking':
      return {
        icon: <Brain size={14} className="opacity-80" />,
        tone: 'bg-[var(--cm-info,#3b82f6)]/15 border-[var(--cm-info,#3b82f6)]/40 text-[var(--cm-info,#3b82f6)]',
        label: msg || 'Thinking…',
        pulse: true,
      };
    case 'streaming':
      return {
        icon: <Sparkles size={14} className="opacity-80" />,
        tone: 'bg-[var(--cm-accent,#a855f7)]/15 border-[var(--cm-accent,#a855f7)]/40 text-[var(--cm-accent,#a855f7)]',
        label: msg || 'Streaming…',
        pulse: true,
      };
    case 'tool_calling':
      return {
        icon: <Wrench size={14} className="opacity-80" />,
        tone: 'bg-[var(--cm-warning,#f59e0b)]/15 border-[var(--cm-warning,#f59e0b)]/40 text-[var(--cm-warning,#f59e0b)]',
        label: msg || 'Calling tool…',
        pulse: true,
      };
    case 'tool_executing':
      return {
        icon: <Zap size={14} className="opacity-80" />,
        tone: 'bg-[var(--cm-warning,#f59e0b)]/15 border-[var(--cm-warning,#f59e0b)]/40 text-[var(--cm-warning,#f59e0b)]',
        label: msg || 'Executing tool…',
        pulse: true,
      };
    case 'error':
      return {
        icon: <Zap size={14} className="opacity-80" />,
        tone: 'bg-[var(--cm-error,#ef4444)]/15 border-[var(--cm-error,#ef4444)]/40 text-[var(--cm-error,#ef4444)]',
        label: msg || 'Error',
        pulse: false,
      };
  }
}

export const TerminalActivityOverlay: React.FC<TerminalActivityOverlayProps> = ({ className }) => {
  const activityState = useActivityState();
  const activityMessage = useActivityMessage();
  const config = configForState(activityState, activityMessage);

  return (
    <div
      // The wrapper itself is non-interactive so clicks pass through to
      // the xterm canvas underneath. Individual chips can opt back in
      // with their own pointer-events if they ever grow click handlers.
      // z-floating from the documented hierarchy (codeMode.css).
      className={clsx(
        'pointer-events-none absolute top-2 right-2 flex flex-col items-end gap-1.5',
        className,
      )}
      style={{ zIndex: 'var(--cm-z-floating, 20)' }}
    >
      <AnimatePresence mode="popLayout">
        {config ? (
          <motion.div
            key={`${activityState}-${config.label}`}
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.95 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className={clsx(
              'flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs',
              'border backdrop-blur-sm shadow-sm',
              config.tone,
            )}
          >
            <span className={clsx('flex-shrink-0', config.pulse && 'animate-pulse')}>
              {config.icon}
            </span>
            <span className="font-medium whitespace-nowrap">{config.label}</span>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
};

export default TerminalActivityOverlay;
