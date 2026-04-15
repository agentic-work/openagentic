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
 * Minimal AuthContext for Pure Frontend Architecture
 * Authentication handled by API - UI only manages display state
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';

interface User {
  id: string;
  userId?: string;
  email: string;
  name?: string;
  displayName?: string;
  is_admin?: boolean;
  isAdmin?: boolean;
  groups?: string[];
  tenantId?: string;
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isApiDown: boolean;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  getAuthHeaders: () => Record<string, string>;
  getAccessToken: (scopes?: string[]) => Promise<string | null>;
  validateSession: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

// Helper function to check if JWT token is expired
const isTokenExpired = (token: string): boolean => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (!payload.exp) return false; // No expiration set
    const expirationTime = payload.exp * 1000; // Convert to milliseconds
    const currentTime = Date.now();
    // Add 30 second buffer to account for clock skew
    return currentTime >= (expirationTime - 30000);
  } catch (error) {
    console.error('Failed to parse JWT token:', error);
    return true; // Treat invalid tokens as expired
  }
};

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isApiDown, setIsApiDown] = useState(false);

  const isAuthenticated = !!user;

  useEffect(() => {
    // Maintenance mode is now checked in App.tsx using runtime config
    // This check is removed to avoid duplication

    // Check for existing auth token on app start
    const token = localStorage.getItem('auth_token');
    if (token) {
      // Validate token with API
      validateToken(token);
    } else {
      setIsLoading(false);
    }
  }, []);

  // Periodic session validation (every 5 minutes)
  useEffect(() => {
    if (!isAuthenticated) return;

    const validationInterval = setInterval(async () => {
      const token = localStorage.getItem('auth_token');

      if (!token) {
        console.warn('[SessionValidation] No token found - logging out');
        await logout();
        return;
      }

      // Check token expiry client-side first
      if (isTokenExpired(token)) {
        console.warn('[SessionValidation] Token expired - logging out');
        await logout();
        return;
      }

      // Validate with server
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const response = await fetch('/api/auth/me', {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${token}` },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          console.warn('[SessionValidation] Server validation failed - logging out');
          await logout();
        }
      } catch (error) {
        console.error('[SessionValidation] Validation check failed:', error);
        // Don't logout on network errors - may be temporary
      }
    }, 5 * 60 * 1000); // Every 5 minutes

    return () => clearInterval(validationInterval);
  }, [isAuthenticated]);

  // Inactivity timeout (30 minutes)
  useEffect(() => {
    if (!isAuthenticated) return;

    let inactivityTimer: ReturnType<typeof setTimeout>;
    const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes

    const resetTimer = () => {
      clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(() => {
        console.warn('[InactivityTimeout] User inactive for 30 minutes - logging out');
        logout();
      }, INACTIVITY_TIMEOUT);
    };

    // Track user interactions
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    events.forEach(event => {
      document.addEventListener(event, resetTimer, true);
    });

    resetTimer(); // Start initial timer

    return () => {
      clearTimeout(inactivityTimer);
      events.forEach(event => {
        document.removeEventListener(event, resetTimer, true);
      });
    };
  }, [isAuthenticated]);

  const validateToken = async (token: string) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch('/api/auth/me', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);

      // Check if API is returning 503 (service unavailable)
      if (response.status === 503) {
        // console.warn('API returned 503 - showing maintenance page');
        setIsApiDown(true);
        return;
      }

      if (response.ok) {
        const userData = await response.json();
        // Map API response to expected format
        // API returns userId, isAdmin (camelCase)
        // UI expects id, is_admin (snake_case)
        const mappedUser: User = {
          id: userData.userId || userData.id,
          userId: userData.userId,
          email: userData.email,
          name: userData.name,
          is_admin: userData.isAdmin || userData.is_admin || false,
          isAdmin: userData.isAdmin || userData.is_admin || false,
          groups: userData.groups || [],
          tenantId: userData.tenantId
        };
        // console.log('User authenticated:', { email: mappedUser.email, isAdmin: mappedUser.isAdmin, groups: mappedUser.groups });
        setUser(mappedUser);
        setIsApiDown(false); // API is working
      } else {
        // Token invalid, remove it
        localStorage.removeItem('auth_token');
        setIsApiDown(false); // API responded, just token invalid
      }
    } catch (error) {
      console.error('Token validation failed:', error);
      
      // Check if it's a network error (API down) vs other error
      if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('fetch'))) {
        // console.warn('API appears to be down - showing maintenance page');
        setIsApiDown(true);
      } else {
        localStorage.removeItem('auth_token');
        setIsApiDown(false);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Wrap login in useCallback for stable reference
  const login = useCallback(async (token: string) => {
    localStorage.setItem('auth_token', token);
    await validateToken(token);
  }, []);

  // Wrap logout in useCallback for stable reference - prevents infinite re-renders
  const logout = useCallback(async () => {
    console.log('[AUTH] Initiating complete logout...');

    try {
      // Call API logout endpoint for server-side cleanup
      const token = localStorage.getItem('auth_token');
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers,
        credentials: 'include', // Ensure cookies are sent
      });
    } catch (error) {
      console.warn('[AUTH] Server-side logout failed, proceeding with client-side cleanup:', error);
    }

    // Clear all auth-related localStorage items
    const authKeys = ['auth_token', 'access_token', 'refresh_token', 'id_token', 'user', 'msal.token'];
    authKeys.forEach(key => {
      localStorage.removeItem(key);
    });

    // Also clear any MSAL-related keys (Azure AD)
    Object.keys(localStorage).forEach(key => {
      if (key.includes('msal') || key.includes('auth') || key.includes('token') || key.includes('login')) {
        localStorage.removeItem(key);
      }
    });

    // Clear sessionStorage completely
    sessionStorage.clear();

    // Clear all cookies by setting them to expire
    const clearCookies = () => {
      const cookies = document.cookie.split(';');
      cookies.forEach(cookie => {
        const name = cookie.split('=')[0].trim();
        // Set cookie to expire for various paths
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/api;`;
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/auth;`;
      });
    };
    clearCookies();

    // Clear user state
    setUser(null);

    console.log('[AUTH] Client-side cleanup complete, redirecting to login');

    // Force hard redirect to login page (not client-side routing)
    // Adding timestamp to bust any caching
    window.location.href = '/login?logout=' + Date.now();
  }, []);

  const getAuthHeaders = useCallback(() => {
    const token = localStorage.getItem('auth_token');

    // Check token expiry before returning headers
    if (token && isTokenExpired(token)) {
      console.warn('[AuthHeaders] Token expired - logging out');
      logout();
      return {};
    }

    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }, [logout]);

  const getAccessToken = useCallback(async (scopes?: string[]): Promise<string | null> => {
    const token = localStorage.getItem('auth_token');

    // Check token expiry before returning
    if (token && isTokenExpired(token)) {
      console.warn('[AccessToken] Token expired - logging out');
      await logout();
      return null;
    }

    return token;
  }, [logout]);

  // Public validateSession function for use by ProtectedRoute
  const validateSession = useCallback(async (): Promise<boolean> => {
    const token = localStorage.getItem('auth_token');

    if (!token) {
      return false;
    }

    // Check token expiry first
    if (isTokenExpired(token)) {
      console.warn('[ValidateSession] Token expired');
      await logout();
      return false;
    }

    // Validate with server
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch('/api/auth/me', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}` },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn('[ValidateSession] Server validation failed');
        await logout();
        return false;
      }

      return true;
    } catch (error) {
      console.error('[ValidateSession] Validation failed:', error);
      return false;
    }
  }, [logout]);

  // Memoize the context value to prevent unnecessary re-renders of consumers
  const contextValue = useMemo(() => ({
    user,
    isAuthenticated,
    isLoading,
    isApiDown,
    login,
    logout,
    getAuthHeaders,
    getAccessToken,
    validateSession
  }), [user, isAuthenticated, isLoading, isApiDown, login, logout, getAuthHeaders, getAccessToken, validateSession]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
};