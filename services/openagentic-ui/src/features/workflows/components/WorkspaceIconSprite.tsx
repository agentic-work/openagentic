/**
 * WorkspaceIconSprite — single-mount SVG sprite that defines every
 * `<symbol id="i-..." />` referenced by `<use href="#i-..." />` in the
 * workspace shell (nav rail + chrome).
 *
 * Mount once at the application root (or anywhere above the rail in the
 * tree). All gradients + symbols are self-contained, so the whole
 * sprite file is a single SVG with `display: 'none'` so it doesn't
 * affect layout.
 *
 * Designed to match docs/mockups/sidebar-endstate.html — same gradient
 * palette and same symbol ids. Adding a new section is a one-line
 * <symbol> addition followed by an entry in WorkspaceNavRail items.
 */

import React from 'react';

export const WorkspaceIconSprite: React.FC = () => (
  <svg
    aria-hidden="true"
    style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
    width="0"
    height="0"
  >
    <defs>
      <linearGradient id="g-blue" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#58a6ff" />
        <stop offset="100%" stopColor="#1f6feb" />
      </linearGradient>
      <linearGradient id="g-purple" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#a78bfa" />
        <stop offset="100%" stopColor="#7c3aed" />
      </linearGradient>
      <linearGradient id="g-green" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#34d399" />
        <stop offset="100%" stopColor="#10b981" />
      </linearGradient>
      <linearGradient id="g-orange" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#fbbf24" />
        <stop offset="100%" stopColor="#f97316" />
      </linearGradient>
      <linearGradient id="g-pink" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#f472b6" />
        <stop offset="100%" stopColor="#db2777" />
      </linearGradient>
      <linearGradient id="g-cyan" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#67e8f9" />
        <stop offset="100%" stopColor="#0891b2" />
      </linearGradient>
    </defs>

    <symbol id="i-home" viewBox="0 0 24 24">
      <path d="M3 10.5L12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="14" r="1.5" fill="url(#g-orange)" />
    </symbol>
    <symbol id="i-flows" viewBox="0 0 24 24">
      <circle cx="5" cy="6" r="2.5" fill="url(#g-blue)" />
      <circle cx="19" cy="6" r="2.5" fill="url(#g-purple)" />
      <circle cx="12" cy="18" r="2.5" fill="url(#g-green)" />
      <path d="M5 8.5v5.5a3 3 0 0 0 3 3h2M19 8.5v5.5a3 3 0 0 1-3 3h-2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </symbol>
    <symbol id="i-agents" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3.2" fill="url(#g-purple)" />
      <circle cx="5" cy="6" r="1.6" fill="currentColor" opacity="0.8" />
      <circle cx="19" cy="6" r="1.6" fill="currentColor" opacity="0.8" />
      <circle cx="5" cy="18" r="1.6" fill="currentColor" opacity="0.8" />
      <circle cx="19" cy="18" r="1.6" fill="currentColor" opacity="0.8" />
      <path d="M6.4 7.2l3.4 3.4M17.6 7.2l-3.4 3.4M6.4 16.8l3.4-3.4M17.6 16.8l-3.4-3.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </symbol>
    <symbol id="i-tools" viewBox="0 0 24 24">
      <rect x="4" y="9" width="16" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 9V5h2v4M14 9V5h2v4" stroke="url(#g-cyan)" strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M12 18v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="9" cy="13" r="0.9" fill="url(#g-green)" />
      <circle cx="15" cy="13" r="0.9" fill="url(#g-green)" />
    </symbol>
    <symbol id="i-runs" viewBox="0 0 24 24">
      <path d="M7 5l13 7-13 7z" fill="url(#g-orange)" />
    </symbol>
    <symbol id="i-insights" viewBox="0 0 24 24">
      <rect x="3" y="13" width="4" height="8" rx="0.8" fill="url(#g-blue)" />
      <rect x="10" y="8" width="4" height="13" rx="0.8" fill="url(#g-purple)" />
      <rect x="17" y="4" width="4" height="17" rx="0.8" fill="url(#g-green)" />
    </symbol>
    <symbol id="i-library" viewBox="0 0 24 24">
      <path d="M5 4h6v16H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path d="M13 4h6a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-6V4z" fill="url(#g-purple)" opacity="0.85" />
      <path d="M7 8h2M7 11h2M7 14h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </symbol>
    <symbol id="i-team" viewBox="0 0 24 24">
      <circle cx="9" cy="8" r="3" fill="url(#g-blue)" />
      <circle cx="17" cy="9" r="2.4" fill="url(#g-purple)" />
      <path d="M3 19c0-3 3-5 6-5s6 2 6 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14 18c1-2 2.5-3 4-3s3 1 4 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </symbol>
    <symbol id="i-settings" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </symbol>
  </svg>
);
