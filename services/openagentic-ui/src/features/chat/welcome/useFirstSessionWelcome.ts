/**
 * useFirstSessionWelcome
 *
 * Orchestrates the post-login WELCOME experience inside the live chat shell.
 *
 * On a fresh / magic-link landing it:
 *   1) fetches the system-status summary (useWelcomeStatus),
 *   2) seeds TWO real assistant messages into the already-active, empty
 *      session — a status line, then an access-aware AI greeting — so the
 *      user lands in a fully-rendered, immediately-typeable chat session
 *      (NOT a static card), and
 *   3) exposes the access-filtered routes for the WelcomeRouteBar shortcuts.
 *
 * "Fresh" = the one-shot magic-link flag (set in App.tsx's MagicLinkHandler)
 * OR a first-ever login on this browser (no `oa_welcomed` marker). Returning
 * users with an existing chat history are NOT re-welcomed, so chat-at-/ is
 * unchanged for them.
 *
 * The seed is idempotent (a module-level guard + the persisted marker) so
 * StrictMode double-mounts and re-renders never duplicate the turn.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import { useUserPermissions } from '@/hooks/useUserPermissions';
import { useChatStore } from '@/stores/useChatStore';
import { useWelcomeStatus } from './useWelcomeStatus';
import {
  accessibleWelcomeRoutes,
  buildGreeting,
  type WelcomeRoute,
} from './welcomeRoutes';

/** sessionStorage flag written by the magic-link exchange (one-shot per landing). */
export const FRESH_LOGIN_FLAG = 'oa_fresh_login';
/** localStorage marker: this browser has already seen the welcome at least once. */
const WELCOMED_MARKER = 'oa_welcomed';

// Module-level guard: survives StrictMode double-mount within a single page load.
let welcomeSeedInFlight = false;

function shouldWelcome(): boolean {
  try {
    if (sessionStorage.getItem(FRESH_LOGIN_FLAG) === '1') return true;
    if (!localStorage.getItem(WELCOMED_MARKER)) return true;
  } catch {
    /* storage unavailable — default to not welcoming to avoid surprises */
  }
  return false;
}

function markWelcomed(): void {
  try {
    sessionStorage.removeItem(FRESH_LOGIN_FLAG);
    localStorage.setItem(WELCOMED_MARKER, String(Date.now()));
  } catch {
    /* ignore */
  }
}

interface UseFirstSessionWelcomeArgs {
  isAuthenticated: boolean;
  /** The session the chat UI is currently bound to (from ChatContainer). */
  activeSessionId: string | null;
  /** Store action — same one ChatContainer already uses for the /help reply. */
  addMessage: (sessionId: string, message: any) => void;
  /** Display name for the greeting (best-effort). */
  displayName: string | null;
}

export function useFirstSessionWelcome({
  isAuthenticated,
  activeSessionId,
  addMessage,
  displayName,
}: UseFirstSessionWelcomeArgs) {
  const { permissions } = useUserPermissions();
  // Decide once per mount whether this landing is a welcome landing.
  const isWelcomeLanding = useMemo(() => isAuthenticated && shouldWelcome(), [isAuthenticated]);

  // Only fetch status when we actually intend to welcome.
  const { status } = useWelcomeStatus({
    isAdmin: !!permissions.isAdmin,
    enabled: isWelcomeLanding,
  });

  // The route shortcuts THIS user can access (chat/flows/admin/tools/docs).
  const routes: WelcomeRoute[] = useMemo(
    () => accessibleWelcomeRoutes(permissions),
    [permissions],
  );

  // Whether the shortcut bar is currently visible (dismissable, on the welcome turn only).
  const [routeBarVisible, setRouteBarVisible] = useState(false);
  const seededRef = useRef(false);

  useEffect(() => {
    if (!isWelcomeLanding) return;
    if (seededRef.current || welcomeSeedInFlight) return;
    // Need an active, empty session to seed into. ChatContainer's loadSessions
    // guarantees one shortly after mount.
    if (!activeSessionId) return;

    // Don't seed into a session that already has history (returning user whose
    // most-recent session was selected) — only an empty "New Chat".
    const session = useChatStore.getState().sessions[activeSessionId];
    if (session && session.messages.length > 0) {
      // Existing conversation present — skip welcome, mark so we don't nag later.
      markWelcomed();
      seededRef.current = true;
      return;
    }

    // Wait for the status probe to resolve before seeding (so the status line
    // is real). status===null means still loading.
    if (!status) return;

    welcomeSeedInFlight = true;
    seededRef.current = true;

    const now = Date.now();

    // 1) System-status summary as a real assistant message.
    addMessage(activeSessionId, {
      id: `welcome-status-${nanoid(6)}`,
      role: 'assistant',
      content: `\`\`\`\n${status.line}\n\`\`\``,
      timestamp: new Date(now).toISOString(),
      status: 'completed',
      // Tag so we (and tests) can identify the seeded welcome turn.
      metadata: { welcome: true, kind: 'status' },
    });

    // 2) Access-aware AI greeting that routes the user.
    addMessage(activeSessionId, {
      id: `welcome-greeting-${nanoid(6)}`,
      role: 'assistant',
      content: buildGreeting({ displayName, routes }),
      timestamp: new Date(now + 1).toISOString(),
      status: 'completed',
      metadata: { welcome: true, kind: 'greeting' },
    });

    setRouteBarVisible(true);
    markWelcomed();
    welcomeSeedInFlight = false;
  }, [isWelcomeLanding, activeSessionId, status, routes, displayName, addMessage]);

  return {
    /** Access-filtered routes for WelcomeRouteBar. */
    routes,
    /** Show the shortcut bar above the composer (welcome turn only, dismissable). */
    routeBarVisible,
    dismissRouteBar: () => setRouteBarVisible(false),
    isWelcomeLanding,
  };
}

export default useFirstSessionWelcome;
