/**
 * WelcomeRouteBar
 *
 * The interactive routing strip rendered on the post-login Welcome turn,
 * sitting just above the live chat composer. Each chip is access-gated by
 * the caller (it only receives routes this user can reach) and dispatches a
 * `oa-welcome-route` CustomEvent that ChatContainer handles to switch app
 * mode / open the right panel.
 *
 * Purely presentational + a dismiss affordance. The chat composer beneath it
 * is always live — this is a shortcut bar, not a gate.
 */

import React from 'react';
import { MessageSquare, Workflow, Shield, Wrench, Book, X, Sparkles } from '@/shared/icons';
import {
  type WelcomeRoute,
  dispatchWelcomeRoute,
} from './welcomeRoutes';

const ICONS: Record<WelcomeRoute['icon'], React.ComponentType<any>> = {
  MessageSquare,
  Workflow,
  Shield,
  Wrench,
  Book,
};

interface WelcomeRouteBarProps {
  routes: WelcomeRoute[];
  onDismiss: () => void;
}

export const WelcomeRouteBar: React.FC<WelcomeRouteBarProps> = ({ routes, onDismiss }) => {
  if (routes.length === 0) return null;

  return (
    <div
      className="px-4 pt-3 pb-1"
      data-testid="welcome-route-bar"
      role="navigation"
      aria-label="Get started shortcuts"
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className="inline-flex items-center gap-1.5 text-xs font-medium"
          style={{ color: 'var(--color-textMuted)' }}
        >
          <Sparkles size={13} style={{ color: 'var(--color-accent, var(--user-accent-primary))' }} />
          Get started
        </span>

        {routes.map((route) => {
          const Icon = ICONS[route.icon];
          return (
            <button
              key={route.id}
              type="button"
              onClick={() => dispatchWelcomeRoute(route.action)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all hover:scale-[1.03]"
              style={{
                background: 'var(--glass-bg, rgba(255,255,255,0.04))',
                border: '1px solid var(--color-border, rgba(255,255,255,0.12))',
                color: 'var(--color-text)',
                backdropFilter: 'blur(8px)',
              }}
              title={route.blurb}
            >
              {Icon ? <Icon size={13} style={{ color: 'var(--color-accent, var(--user-accent-primary))' }} /> : null}
              {route.label}
            </button>
          );
        })}

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss get-started shortcuts"
          className="ml-auto inline-flex items-center justify-center p-1 rounded-md transition-colors"
          style={{ color: 'var(--color-textMuted)' }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};

export default WelcomeRouteBar;
