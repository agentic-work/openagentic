import React, { useMemo, useEffect } from 'react';
import { CodeModeChatView } from './components/CodeModeChatView';
import './codeMode.css';

// Apply the same stored CM theme that the main window uses so the pop-out
// inherits the user's colour scheme preference on open.
function applyStoredCMTheme(): void {
  try {
    const id = localStorage.getItem('cm-theme') || 'default';
    if (id !== 'default') {
      document.documentElement.setAttribute('data-cm-theme', id);
    }
  } catch {
    // localStorage unavailable — stay on default
  }
}

export const OpenagenticWindowPage: React.FC = () => {
  const sessionId = useMemo(() => {
    try {
      return new URLSearchParams(window.location.search).get('sessionId') || null;
    } catch {
      return null;
    }
  }, []);

  const authToken = useMemo(() => {
    try { return localStorage.getItem('auth_token') || undefined; } catch { return undefined; }
  }, []);

  // Apply CM theme and set a descriptive window title.
  useEffect(() => {
    applyStoredCMTheme();
    document.title = sessionId
      ? `openagentic · ${sessionId.slice(0, 8)}`
      : 'openagentic';
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: 'var(--cm-bg, #0d1117)',
          color: 'var(--cm-text-muted, #888)',
          fontFamily: 'ui-monospace, monospace',
          fontSize: 13,
        }}
      >
        No session ID — close this window and pop it out from the main openagentic view.
      </div>
    );
  }

  return (
    <div
      className="code-mode"
      style={{
        width: '100vw',
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        background: 'var(--cm-bg, #0d1117)',
      }}
    >
      <CodeModeChatView sessionId={sessionId} authToken={authToken} />
    </div>
  );
};

export default OpenagenticWindowPage;
