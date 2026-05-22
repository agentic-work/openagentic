/**
 * Main Application Component
 * Root component that sets up routing, authentication, theming, and global providers
 * Features: Protected routes, auth flow, theme management, error boundaries
 * @see docs/architecture/app-structure.md
 */

import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import Chat from '@/features/chat/components/ChatContainer';
import Login from '@/features/auth/components/Login';
import LoginDev from '@/features/auth/components/LoginDev';
import AuthCallback from '@/features/auth/components/AuthCallback';
import AccessDenied from '@/features/auth/components/AccessDenied';
// #502 v2 primitives showcase — visual smoke test for every mock-parity
// primitive shipped under @/features/chat/components/v2. Dev-only,
// lazy-loaded, gated by !import.meta.env.PROD so prod bundles DCE it out.
const PrimitivesShowcase = !import.meta.env.PROD
  ? React.lazy(() => import('@/pages/PrimitivesShowcase'))
  : null;
// AdminPortal removed - lazy loaded in ChatContainer
// WorkflowsPage removed from App.tsx routes — Flows is reached only via
// the in-app sidebar Flows tab (embedded inside ChatContainer). Direct
// /workflows navigation is now a 404. Mirrors the Code Mode entry path.
import ErrorBoundary from '@/shared/components/ErrorBoundary';
import { AuthProvider, useAuth } from './providers/AuthContext';
import { useTheme, ThemeProvider } from '@/contexts/ThemeContext';
import { MCPProvider } from './providers/MCPContext';
import { ConfirmProvider } from '@/shared/hooks/useConfirm';
// Security headers handled by API - pure frontend architecture
// import { DevTestLogin } from './components/DevTestLogin';
import { apiEndpoint } from '@/utils/api';
import NotFound from '@/shared/components/NotFound';
import { loggers } from '@/utils/logger';
import { NotificationContainer, useNotifications } from '@/shared/ui/Notification';
import MaintenancePage from '@/components/MaintenancePage';
import { getMaintenanceMode, getDevLoginPage } from '@/config/runtime';
import MinimalBackground from '@/shared/components/MinimalBackground';
// OnboardingTutorial and WelcomeCapabilitySelector removed — replaced by OnboardingTour in ChatContainer

// Logout component that handles logout and redirect
const LogoutHandler: React.FC = () => {
  const { logout } = useAuth();
  
  React.useEffect(() => {
    logout().then(() => {
      // Redirect to home after logout
      window.location.href = '/';
    }).catch(() => {
      // If logout fails, still redirect to clear the URL
      window.location.href = '/';
    });
  }, [logout]);
  
  return (
    <div className="min-h-screen flex items-center justify-center relative z-content">
      <div className="text-center glass-card">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto"></div>
        <p className="mt-4 text-text-secondary">Logging out...</p>
      </div>
    </div>
  );
};

// Protected route component with route-change session validation
const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isLoading, isApiDown, validateSession } = useAuth();
  const location = useLocation();
  const [isValidating, setIsValidating] = useState(false);

  // Validate session on every route change
  useEffect(() => {
    const checkSession = async () => {
      if (isAuthenticated && !isValidating) {
        setIsValidating(true);
        const isValid = await validateSession();
        setIsValidating(false);

        if (!isValid) {
          loggers.auth.warn('[RouteChange] Session validation failed - user will be redirected to login');
        }
      }
    };

    checkSession();
  }, [location.pathname, isAuthenticated]);

  // Show maintenance page if API is down
  if (isApiDown) {
    return <MaintenancePage />;
  }

  if (isLoading || isValidating) {
    return (
      <div className="min-h-screen flex items-center justify-center relative z-content">
        <div className="text-center glass-card">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto"></div>
          <p
          className="mt-4"
          style={{ color: 'var(--color-textMuted)' }}>
            {isValidating ? 'Validating session...' : 'Loading...'}
          </p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    loggers.auth.info('Not authenticated, redirecting to login');
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

// Main app content that needs auth
function AppContent(): React.ReactElement {
  const navigate = useNavigate();
  const [chatFunctions, setChatFunctions] = useState<{
    createNewSession: () => void;
    toggleMetrics: () => void;
    openMonitor: () => void;
    toggleSidebar: () => void;
  } | null>(null);
  const [showMetricsPanel, setShowMetricsPanel] = useState(false);

  // Capability selection handler removed — starter prompts now inline in ChatContainer
  const { isAuthenticated, user, getAuthHeaders, isApiDown } = useAuth();
  const { notifications, removeNotification } = useNotifications();
  const { theme, resolvedTheme, changeTheme, changeAccentColor, accentColors, toggleBackgroundAnimations, backgroundAnimations, backgroundEffect, setBackgroundEffect, themes } = useTheme();

  // Check if DEV_LOGIN_PAGE environment variable is set (runtime config)
  const useDevLoginPage = getDevLoginPage();
  const LoginComponent = useDevLoginPage ? LoginDev : Login;

  // Handle theme change with API call - only light/dark
  const handleThemeChange = async (newTheme: 'light' | 'dark') => {
    // Set the theme
    changeTheme(newTheme);
    
    // Save theme to backend
    try {
      const authHeaders = await getAuthHeaders();
      await fetch(apiEndpoint('/settings'), {
        method: 'PUT',
        headers: {
          ...authHeaders,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ theme: newTheme })
      });
    } catch (error) {
      loggers.app.error('Failed to save theme', { error });
    }
  };
  
  // Load theme from API only once on mount - ThemeContext handles localStorage
  useEffect(() => {
    const loadSettings = async () => {
      try {
        const authHeaders = getAuthHeaders();
        const res = await fetch(apiEndpoint('/settings'), {
          headers: authHeaders,
        });

        if (!res.ok) {
          // Suppress 401 warnings on initial load (expected before login)
          if (res.status !== 401) {
            loggers.app.warn('Settings endpoint returned non-success status', { status: res.status });
          }
          return; // Don't override localStorage theme on error
        }

        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          loggers.app.error('Settings endpoint did not return JSON', { contentType });
          return;
        }

        const data = await res.json();

        // Load all UI preferences from API if localStorage is empty (first time user)
        const hasExistingSettings = localStorage.getItem('ac-theme') ||
                                  localStorage.getItem('ac-accent-color') ||
                                  localStorage.getItem('ac-background-animations');

        if (!hasExistingSettings && data.ui_preferences) {
          const prefs = data.ui_preferences;

          // Theme
          if (prefs.theme && (prefs.theme === 'light' || prefs.theme === 'dark' || prefs.theme === 'system')) {
            changeTheme(prefs.theme);
          }

          // Accent Color
          if (prefs.accentColor) {
            const matchingColor = accentColors.find(color =>
              color.name === prefs.accentColor.name || color.primary === prefs.accentColor.primary
            );
            if (matchingColor) {
              changeAccentColor(matchingColor);
            }
          }

          // Background Animations
          if (typeof prefs.backgroundAnimations === 'boolean') {
            if (prefs.backgroundAnimations !== true) { // Only set if different from default
              toggleBackgroundAnimations();
            }
          }
        }

        // Legacy theme support (for backwards compatibility)
        else if (data && data.theme && (data.theme === 'light' || data.theme === 'dark' || data.theme === 'system')) {
          const currentTheme = localStorage.getItem('ac-theme');
          if (!currentTheme) {
            changeTheme(data.theme);
          }
        }
      } catch (err) {
        loggers.app.error('Failed to load settings', { error: err });
        // Don't override theme on error - let ThemeContext handle it
      }
    };

    loadSettings();
  }, []); // Only run once on mount
  
  return (
    <div
      className="min-h-screen relative overflow-hidden theme-root"
      style={{
        backgroundColor: backgroundEffect === 'subtle' ? 'transparent' : 'var(--color-background)',
        color: 'var(--color-text)'
      }}
    >
      {/* Background effect - Subtle gradient (zero GPU) */}
      {backgroundEffect === 'subtle' && <MinimalBackground />}

      {/* Dev test login overlay */}
      {/* <DevTestLogin /> */}

      {/* Main content layer */}
      <div className="relative z-10 min-h-screen">
        <div className="min-h-screen">
          <Routes>
            {/* Phase-0 visual mock — NO auth, NO app shell. Just the static
                mock page so the user can review the design directly.
                Plan: ~/.claude/plans/sprightly-percolating-brook.md */}
            {PrimitivesShowcase && (
              <Route
                path="/dev/v2-primitives"
                element={
                  <React.Suspense fallback={<div style={{ padding: 24, color: '#8b949e' }}>Loading showcase…</div>}>
                    <PrimitivesShowcase />
                  </React.Suspense>
                }
              />
            )}
            <Route path="/login" element={
              isAuthenticated ? <Navigate to="/" replace /> : <LoginComponent />
            } />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/auth/access-denied" element={<AccessDenied />} />
            <Route path="/logout" element={<LogoutHandler />} />
            <Route path="/*" element={
              <ProtectedRoute>
                <Routes>
                  <Route path="/" element={
                    <Chat
                      theme={themes[resolvedTheme]}
                      onThemeChange={handleThemeChange}
                      onFunctionsReady={setChatFunctions}
                      showMetricsPanel={showMetricsPanel}
                    />
                  } />
                  <Route path="/chat" element={
                    <Chat
                      theme={themes[resolvedTheme]}
                      onThemeChange={handleThemeChange}
                      onFunctionsReady={setChatFunctions}
                      showMetricsPanel={showMetricsPanel}
                    />
                  } />
                  {/* 2026-05-07 — /admin{/*} renders the chat shell which
                      mounts AdminPortalHost. Triggers `showAdminPortal=true`
                      on mount via ChatContainer's pathname effect, so direct
                      links like /admin#integrations or /admin/llm/models
                      land on the admin pane instead of the 404 page. Hash
                      fragment is consumed by AdminShellV2 sidebar router. */}
                  <Route path="/admin/*" element={
                    <Chat
                      theme={themes[resolvedTheme]}
                      onThemeChange={handleThemeChange}
                      onFunctionsReady={setChatFunctions}
                      showMetricsPanel={showMetricsPanel}
                    />
                  } />
                  <Route path="/admin" element={
                    <Chat
                      theme={themes[resolvedTheme]}
                      onThemeChange={handleThemeChange}
                      onFunctionsReady={setChatFunctions}
                      showMetricsPanel={showMetricsPanel}
                    />
                  } />
                  {/* 2026-05-07 — legacy /settings page ripped (1135-line
                      "OpenAgenticCode" Settings.tsx). Tenant config moves to
                      /admin#integrations; per-user GitHub OAuth bounces back
                      there via api github.ts:DEFAULT_LANDING. Any direct
                      /settings link 404s, which is correct now. */}

                  {/* OpenAgentic Flows is reached via the in-app sidebar Flows
                      tab (rendered embedded inside ChatContainer), not as a
                      public URL. Direct /workflows navigation is intentionally
                      a 404 so the entry path is always: log in → click Flows.
                      Mirrors the Code Mode entry pattern above. */}

                  <Route path="*" element={<NotFound />} />
                </Routes>
              </ProtectedRoute>
            } />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </div>
      <NotificationContainer notifications={notifications} onClose={removeNotification} />

      {/* Onboarding handled by OnboardingTour in ChatContainer — lightweight tooltip tour */}
    </div>
  );
}

// B'-14 (2026-05-07): catch dynamic-import failures from stale chunk
// references and trigger a one-time index.html reload so the user
// gets the new chunk-hash mapping. Vite content-hashes every lazy
// chunk, so after a deploy the OLD index.html in the user's tab
// references chunks that no longer exist on the server, leading to
// "Failed to fetch dynamically imported module" 404s. The browser
// retains the stale index.html in memory until a navigation; this
// handler forces the reload.
//
// Guard: store a session-flag so we don't loop-reload if a real
// network outage is the actual cause. One reload per browser tab,
// then we let the error surface so the user can see it.
function installStaleChunkHandler() {
  if (typeof window === 'undefined') return;
  const RELOAD_FLAG = 'aw-stale-chunk-reload-v1';
  const isStaleChunkError = (msg: unknown): boolean => {
    const s = String(msg ?? '').toLowerCase();
    return (
      s.includes('failed to fetch dynamically imported module') ||
      s.includes('failed to load module') ||
      s.includes('importing a module script failed') ||
      s.includes("'text/html' is not a valid javascript")
    );
  };
  const tryReload = () => {
    if (sessionStorage.getItem(RELOAD_FLAG) === '1') return; // already retried
    try { sessionStorage.setItem(RELOAD_FLAG, '1'); } catch { /* ignore */ }
    // Force-bypass cache via cache-busting query string + reload.
    const url = new URL(window.location.href);
    url.searchParams.set('_v', String(Date.now()));
    window.location.replace(url.toString());
  };
  window.addEventListener('error', (e) => {
    if (isStaleChunkError(e?.message) || isStaleChunkError((e?.error as any)?.message)) {
      tryReload();
    }
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (isStaleChunkError((e?.reason as any)?.message) || isStaleChunkError(e?.reason)) {
      tryReload();
    }
  });
}
installStaleChunkHandler();

function App(): React.ReactElement {
  // Check for maintenance mode flag from runtime configuration
  const isMaintenanceMode = getMaintenanceMode();

  if (isMaintenanceMode) {
    return (
      <ErrorBoundary>
        <MaintenancePage />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <MCPProvider>
            <ConfirmProvider>
              <Router>
                <AppContent />
              </Router>
            </ConfirmProvider>
          </MCPProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
