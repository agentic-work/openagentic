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
import Settings from '@/features/settings/components/Settings';
import Login from '@/features/auth/components/Login';
import LoginDev from '@/features/auth/components/LoginDev';
import AuthCallback from '@/features/auth/components/AuthCallback';
import AccessDenied from '@/features/auth/components/AccessDenied';
// AdminPortal removed - lazy loaded in ChatContainer
import { WorkflowsPage } from '@/features/workflows/components/WorkflowsPage';
import { CodeModePage } from '@/features/code/components';
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
                  <Route path="/settings" element={<Settings />} />

                  {/* Code Mode - AI Coding Assistant */}
                  <Route path="/code" element={
                    <CodeModePage />
                  } />

                  {/* OpenAgentic Flows - Native Workflow Builder */}
                  <Route path="/workflows" element={
                    <WorkflowsPage />
                  } />
                  <Route path="/workflows/:workflowId" element={
                    <WorkflowsPage />
                  } />

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
