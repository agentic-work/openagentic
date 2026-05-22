/**
 * CodeModePage - Main entry point for Code Mode
 *
 * Renders the Openagentic-style Code Mode interface (CodeModeLayout).
 * Handles authentication, Code Mode access check, and WebSocket connection.
 *
 * Flow:
 * 1. Check if user has Code Mode access (`/api/code/provisioning/status`
 *    with `hasAccess` flag).
 * 2. If no access → friendly error screen.
 * 3. Otherwise render CodeModeLayout. The unified boot gate
 *    (InlineBootStream) inside that layout drives the real pod health
 *    checks — no secondary provisioning overlay is mounted here.
 */

import React, { useEffect, useCallback, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/app/providers/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';
import { apiEndpoint } from '@/utils/api';

import { CodeModeLayout } from './CodeModeLayout';
import { useCodeModeWebSocket } from '../hooks/useCodeModeWebSocket';
import { useCodeModeSession } from '../hooks/useCodeModeSession';
import { useCodeModeStore, useSession } from '@/stores/useCodeModeStore';
import ErrorBoundary from '@/shared/components/ErrorBoundary';
import { FilePanel } from '../../../codemode/components/FilePanel';

// Feature flag — localStorage opt-in for staged rollout.
// Default ON; set cm-file-panel=0 or cm-file-panel=false to disable.
// IMPORTANT: read via a function INSIDE render, not a module-level IIFE.
// Vite's static-analysis treated the IIFE as constant-foldable in some
// builds and tree-shook the FilePanel branch out of the bundle entirely.
// Reading inside render forces runtime evaluation and prevents pruning.
function isFilePanelEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const v = window.localStorage.getItem('cm-file-panel');
  return v !== '0' && v !== 'false';
}

/** Thin access-gate state. Any non-`no_access` value falls through to the
 * unified boot modal inside CodeModeLayout, which owns real pod health. */
type AccessStatus = 'checking' | 'ready' | 'no_access' | 'error';

export const CodeModePage: React.FC = () => {
  const { user, getAuthHeaders } = useAuth();
  const { resolvedTheme } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const session = useSession();

  const [accessStatus, setAccessStatus] = useState<AccessStatus>('checking');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Access gate: one `/code/provisioning/status` call on mount tells us
  // whether this user is entitled to Code Mode. If yes, we fall through
  // to the layout regardless of pod state — the boot modal takes over
  // from there and runs the real health checks against the per-user pod.
  useEffect(() => {
    const checkAccess = async () => {
      try {
        const response = await fetch(apiEndpoint('/code/provisioning/status'), {
          headers: getAuthHeaders(),
        });

        if (!response.ok) {
          if (response.status === 401) {
            navigate('/login');
            return;
          }
          throw new Error('Failed to check Code Mode access');
        }

        const data = await response.json();
        if (!data.success) {
          throw new Error(data.error || 'Failed to check status');
        }

        if (!data.hasAccess) {
          setAccessStatus('no_access');
          setErrorMessage('Code Mode is not enabled for your account. Please contact your administrator.');
          return;
        }

        setAccessStatus('ready');
        useCodeModeStore.getState().activateCodeMode();
      } catch (err: any) {
        console.error('Failed to check Code Mode access:', err);
        setAccessStatus('error');
        setErrorMessage(err.message || 'Failed to check Code Mode access');
      }
    };
    checkAccess();
  }, [getAuthHeaders, navigate]);

  // Get session params from URL (if coming from admin panel)
  const sessionId = searchParams.get('sessionId');
  const workspacePath = searchParams.get('workspace');

  // Get auth token for API mode (allows using platform LLM providers)
  // This token is passed to the backend which forwards it to CLI for LLM calls
  const authToken = localStorage.getItem('auth_token') || undefined;

  // Reset init steps when entering code mode so stale state from previous sessions is cleared
  useEffect(() => {
    if (accessStatus === 'ready') {
      useCodeModeStore.getState().resetInitSteps();
    }
  }, [accessStatus]);

  // Hydrate prior session transcript on mount.
  //
  // Zustand `persist` middleware keeps `activeSessionId` in localStorage,
  // but the `messages` array is intentionally NOT persisted (transcripts
  // can be huge). After a tab switch / browser reload / re-login the store
  // has the session id but an empty messages array — without this effect
  // the WS would just connect to a new session and the user would see an
  // empty chat even though the server still has every prior turn.
  //
  // The effect:
  //   1. Reads `activeSessionId` from the store
  //   2. Calls `/api/openagentic/sessions/:id/resume` via useCodeModeSession
  //   3. Fills `messages[]` losslessly via store.hydrateMessages()
  //   4. Releases the WS gate (`hydrated`) so it connects with the
  //      existing session id rather than racing to create a fresh one
  //
  // If the API returns 404 (session reaped server-side) we clear the
  // stale id and start fresh.
  const { resumeSession } = useCodeModeSession({
    authToken: authToken ?? '',
    persistMessages: false,
    autoLoadHistory: false,
  });
  const storedSessionId = useCodeModeStore((s) => s.activeSessionId);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (accessStatus !== 'ready') return;
    if (hydrated) return;

    // No prior session — nothing to resume; release the WS gate immediately.
    if (!storedSessionId || !authToken) {
      setHydrated(true);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const result = await resumeSession(storedSessionId);
        if (cancelled) return;
        if (!result) {
          // Session no longer exists server-side. Drop the stale id so the
          // next WS connect creates a fresh session instead of trying to
          // reattach to a tombstone.
          console.warn(
            '[CodeModePage] Resume failed for stored session — clearing and starting fresh',
            { storedSessionId },
          );
          useCodeModeStore.getState().clearSession();
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[CodeModePage] Resume threw:', err);
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessStatus, storedSessionId, authToken, resumeSession, hydrated]);

  // Connect WebSocket (only when provisioned AND hydration finished).
  // The hydrated gate prevents a race where the WS spins up a new session
  // before resumeSession finishes loading the prior transcript.
  const { sendMessage, stopExecution } = useCodeModeWebSocket({
    userId: user?.id || 'anonymous',
    initialSessionId: sessionId || undefined,
    workspacePath: workspacePath || '~',
    authToken,
    enabled: accessStatus === 'ready' && hydrated,
  });

  // Handle exit - navigate back
  const handleExit = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  // Loading/Checking state
  if (accessStatus === 'checking') {
    return (
      <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-[var(--color-background)]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[var(--color-success)] mx-auto" />
          <p className="mt-4 text-[var(--color-textMuted)]">Checking environment status...</p>
        </div>
      </div>
    );
  }

  // No access state
  if (accessStatus === 'no_access') {
    return (
      <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-[var(--color-background)]">
        <div className="text-center max-w-md mx-4">
          <div className="text-5xl mb-4">
            <span className="text-[var(--color-error)]">⚠️</span>
          </div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)] mb-2">Access Denied</h1>
          <p className="text-[var(--color-textMuted)] mb-6">{errorMessage}</p>
          <button
            onClick={() => navigate(-1)}
            className="px-6 py-2 rounded-lg bg-[var(--color-surfaceSecondary)] hover:bg-[var(--color-surfaceHover)] text-[var(--color-text)] font-medium transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // Error state
  if (accessStatus === 'error') {
    return (
      <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-[var(--color-background)]">
        <div className="text-center max-w-md mx-4">
          <div className="text-5xl mb-4">
            <span className="text-[var(--color-error)]">❌</span>
          </div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)] mb-2">Something Went Wrong</h1>
          <p className="text-[var(--color-textMuted)] mb-6">{errorMessage}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-2 rounded-lg bg-[var(--color-success)] hover:opacity-90 text-white font-medium transition-colors"
            >
              Try Again
            </button>
            <button
              onClick={() => navigate(-1)}
              className="px-6 py-2 rounded-lg bg-[var(--color-surfaceSecondary)] hover:bg-[var(--color-surfaceHover)] text-[var(--color-text)] font-medium transition-colors"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Ready — the unified boot modal inside CodeModeLayout owns all
  // remaining gate logic from this point. CodeModePage no longer
  // switches on pod state.
  //
  // Wrapped in a codemode-scoped ErrorBoundary so a render crash deep
  // inside the layout (e.g. InlineBootStream stream error on fetch, a
  // prop-shape drift, a new hook throwing) does not white-page the
  // whole app. The boundary shows the error + reload button in-place.
  const layout = (
    <CodeModeLayout
      userId={user?.id || 'anonymous'}
      workspacePath={workspacePath || session?.workspacePath || '~'}
      onExit={handleExit}
      theme={resolvedTheme as 'light' | 'dark'}
      onSendMessage={sendMessage}
      onStopExecution={stopExecution}
      hostname={session?.hostname}
      cliVersion={session?.cliVersion}
      storageBucket={session?.storageBucket}
      storageType={session?.storageType}
    />
  );

  // BISECT-SENTINEL-7B41A2 — if this string isn't in the prod bundle,
  // the main render path is being eliminated entirely.
  console.log('CODEMODEPAGE_RENDER_BISECT_7B41A2');

  return (
    <ErrorBoundary>
      {isFilePanelEnabled() ? (
        <FilePanel rootPath={workspacePath || session?.workspacePath || '/workspaces'}>
          {layout}
        </FilePanel>
      ) : (
        layout
      )}
    </ErrorBoundary>
  );
};

export default CodeModePage;
