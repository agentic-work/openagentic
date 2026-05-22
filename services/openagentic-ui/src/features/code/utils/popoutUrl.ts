/**
 * buildPopoutUrl — construct the URL for the openagentic pop-out window.
 *
 * Usage:
 *   window.open(buildPopoutUrl(sessionId), 'openagentic-' + sessionId, '...')
 *
 * The route /openagentic-window is registered in App.tsx outside the normal
 * sidebar-nav flow so it renders a chrome-free shell (no sidebar, no topbar)
 * containing only CodeModeChatView for the given session.
 */
export function buildPopoutUrl(sessionId: string): string {
  const params = new URLSearchParams({ sessionId });
  return `/openagentic-window?${params.toString()}`;
}
