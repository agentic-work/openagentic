/**
 * welcomeRoutes
 *
 * The set of destinations the post-login Welcome turn can route a user to.
 * Each route declares an `access` predicate over the user's resolved
 * permissions so the Welcome surface only ever offers what THIS user can
 * actually reach. Admin is gated strictly behind isAdmin; Flows behind the
 * workflows grant; the rest are baseline.
 *
 * The `action` is a discriminated tag consumed by ChatContainer (via the
 * `oa-welcome-route` CustomEvent) so this config carries no React/store deps
 * and stays trivially testable.
 */

import type { UserPermissions } from '@/hooks/useUserPermissions';

export type WelcomeRouteAction =
  | { kind: 'chat' }
  | { kind: 'flows' }
  | { kind: 'admin' }
  | { kind: 'tools' }
  | { kind: 'docs' };

export interface WelcomeRoute {
  id: 'chat' | 'flows' | 'admin' | 'tools' | 'docs';
  label: string;
  /** Short, AI-greeting-friendly blurb used both on the chip and in the seeded greeting. */
  blurb: string;
  /** lucide-style icon name (resolved in WelcomeRouteBar). */
  icon: 'MessageSquare' | 'Workflow' | 'Shield' | 'Wrench' | 'Book';
  action: WelcomeRouteAction;
  /** Returns true when the route should be offered to this user. */
  access: (p: UserPermissions) => boolean;
}

export const WELCOME_ROUTES: WelcomeRoute[] = [
  {
    id: 'chat',
    label: 'Chat',
    blurb: 'ask a question or kick off a task right here',
    icon: 'MessageSquare',
    action: { kind: 'chat' },
    access: () => true,
  },
  {
    id: 'flows',
    label: 'Flows',
    blurb: 'build and run multi-step agent workflows',
    icon: 'Workflow',
    action: { kind: 'flows' },
    // Admins always; otherwise only when the workflows grant is set.
    access: (p) => p.isAdmin || p.workflowsEnabled,
  },
  {
    id: 'tools',
    label: 'Tools',
    blurb: 'browse the connected MCP tools you can call',
    icon: 'Wrench',
    action: { kind: 'tools' },
    // Tools panel respects the per-user MCP panel grant.
    access: (p) => p.mcpPanelEnabled,
  },
  {
    id: 'admin',
    label: 'Admin',
    blurb: 'manage providers, MCP fleet, users and audit',
    icon: 'Shield',
    action: { kind: 'admin' },
    // STRICTLY admin-only — never surfaced to a non-admin.
    access: (p) => p.isAdmin,
  },
  {
    id: 'docs',
    label: 'Docs',
    blurb: 'read the platform guide',
    icon: 'Book',
    action: { kind: 'docs' },
    access: () => true,
  },
];

/** The routes THIS user can access, in display order. */
export function accessibleWelcomeRoutes(p: UserPermissions): WelcomeRoute[] {
  return WELCOME_ROUTES.filter((r) => r.access(p));
}

/**
 * The AI greeting body. Lists ONLY the routes this user can access so the
 * model never points a non-admin at the admin console. Markdown so it renders
 * through the normal MessageBubble path.
 */
export function buildGreeting(opts: {
  displayName: string | null;
  routes: WelcomeRoute[];
}): string {
  const { displayName, routes } = opts;
  const hi = displayName ? `Welcome back, ${displayName}.` : 'Welcome to OpenAgentic.';
  const lines = routes
    // Chat is implicit (we're already in it) — describe the destinations.
    .filter((r) => r.id !== 'chat')
    .map((r) => `- **${r.label}** — ${r.blurb}`);
  const body =
    lines.length > 0
      ? `\n\nHere's what you can do from here:\n\n${lines.join('\n')}\n\nWhat would you like to work on? You can tell me below, or use the shortcuts.`
      : `\n\nAsk me anything below to get started.`;
  return `${hi} I'm your agent — everything's connected and ready.${body}`;
}

/** Custom DOM event name used to bridge a route chip click into ChatContainer. */
export const WELCOME_ROUTE_EVENT = 'oa-welcome-route';

export function dispatchWelcomeRoute(action: WelcomeRouteAction): void {
  window.dispatchEvent(new CustomEvent<WelcomeRouteAction>(WELCOME_ROUTE_EVENT, { detail: action }));
}
