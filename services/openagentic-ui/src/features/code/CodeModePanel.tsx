/**
 * CodeModePanel — orchestrates the Code Mode experience.
 *
 * Renders one of three states:
 *   1. Loading  — while first-run status is being fetched from the API.
 *   2. Wizard   — when no session is active; the wizard step depends on
 *                 whether the user has completed the first-run flow.
 *   3. Terminal — once a session has been launched / is active.
 *
 * Convention: the active session is stored both in local state (for the
 * lifetime of this panel) and in `useCodeModeStore` (so other parts of
 * the UI — header, sidebar — can observe it).
 */
import React, { useState } from 'react';
import { Terminal } from './Terminal';
import { CodeModeChat } from './CodeModeChat';
import { AgenticodeGridView } from './AgenticodeGridView';
import { CodeModeWizard } from './wizard/CodeModeWizard';
import { useCodeModeFirstRun } from './useCodeModeFirstRun';
import { useCodeModeStore } from '@/stores/useCodeModeStore';
import type { CodeSession } from '@/stores/useCodeModeStore';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const CodeModePanel: React.FC = () => {
  const { firstRunComplete, loading, markComplete } = useCodeModeFirstRun();

  const setActiveSession = useCodeModeStore((s) => s.setActiveSession);
  const storeSession = useCodeModeStore((s) => s.session);

  // Local session state — initialise from the store so switching back to
  // Code Mode after navigating away re-uses the still-live session.
  const [localSession, setLocalSession] = useState<CodeSession | null>(storeSession);

  // Resolved session: prefer local state (covers the "just launched" path)
  // but fall back to whatever the store says (covers "returned to code tab").
  const activeSession = localSession ?? storeSession;

  const handleLaunched = (session: CodeSession) => {
    // Persist into the store for cross-component visibility.
    setActiveSession(session.sessionId, session);
    setLocalSession(session);

    // If this was the user's first run, record it.
    if (!firstRunComplete) {
      void markComplete({ model: session?.model });
    }
  };

  // --- agenticode TUI → DOM demo (Path A: own Ink reconciler + pure-TS Yoga →
  // char-grid → DOM, no xterm). Reach via the Code tab with hash #agc. ---
  if (typeof location !== 'undefined' && location.hash === '#agc') {
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <AgenticodeGridView />
      </div>
    );
  }

  // --- Active session → show terminal (skip loading gate if we already have one) ---
  if (activeSession) {
    // 'chat' → CodeModeChat (stream-json → React, no xterm); else legacy xterm.
    const isChat = (activeSession as { mode?: string }).mode === 'chat';
    return (
      <div style={{ width: '100%', height: '100%' }}>
        {isChat
          ? <CodeModeChat sessionId={activeSession.sessionId} />
          : <Terminal sessionId={activeSession.sessionId} />}
      </div>
    );
  }

  // --- Still fetching first-run status and no session yet → loading placeholder ---
  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          height: '100%',
          color: 'var(--ap-fg-3, #666)',
          fontSize: 13,
        }}
      >
        Loading Code Mode…
      </div>
    );
  }

  // --- No session → show wizard ---
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        padding: 24,
      }}
    >
      <CodeModeWizard
        startStep={firstRunComplete ? 'model' : 'welcome'}
        onLaunched={handleLaunched}
      />
    </div>
  );
};

export default CodeModePanel;
