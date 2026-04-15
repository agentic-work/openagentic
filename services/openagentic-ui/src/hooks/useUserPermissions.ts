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
 * User Permissions Hook
 *
 * Fetches the current user's resolved permissions from the API.
 * Permissions determine feature access like MCP servers, workflows, etc.
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/app/providers/AuthContext';
import { apiEndpoint } from '@/utils/api';

export interface UserPermissions {
  userId: string;
  isAdmin: boolean;
  allowedLlmProviders: string[];
  deniedLlmProviders: string[];
  allowedMcpServers: string[];
  deniedMcpServers: string[];
  dailyTokenLimit: number | null;
  monthlyTokenLimit: number | null;
  dailyRequestLimit: number | null;
  monthlyRequestLimit: number | null;
  canUseImageGeneration: boolean;
  canUseCodeExecution: boolean;
  canUseWebSearch: boolean;
  canUseFileUpload: boolean;
  canUseMemory: boolean;
  canUseRag: boolean;
  canUseAwcode: boolean;
  mcpPanelEnabled: boolean;
  source: 'user' | 'group' | 'default';
}

const DEFAULT_PERMISSIONS: UserPermissions = {
  userId: '',
  isAdmin: false,
  allowedLlmProviders: [],
  deniedLlmProviders: [],
  allowedMcpServers: [],
  deniedMcpServers: [],
  dailyTokenLimit: null,
  monthlyTokenLimit: null,
  dailyRequestLimit: null,
  monthlyRequestLimit: null,
  canUseImageGeneration: true,
  canUseCodeExecution: true,
  canUseWebSearch: true,
  canUseFileUpload: true,
  canUseMemory: true,
  canUseRag: true,
  canUseAwcode: false, // AWCode disabled by default, admins always have access
  mcpPanelEnabled: true,
  source: 'default',
};

export const useUserPermissions = () => {
  const { isAuthenticated, getAccessToken, user } = useAuth();
  const [permissions, setPermissions] = useState<UserPermissions>(DEFAULT_PERMISSIONS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPermissions = useCallback(async () => {
    if (!isAuthenticated) {
      setPermissions(DEFAULT_PERMISSIONS);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const token = await getAccessToken(['User.Read']);

      const response = await fetch(apiEndpoint('/user/permissions'), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        // If permissions fetch fails, use defaults with isAdmin from user object
        const isAdmin = user?.is_admin ||
                        user?.groups?.includes('OpenAgenticAdmins') ||
                        user?.groups?.includes('admin') ||
                        false;

        setPermissions({
          ...DEFAULT_PERMISSIONS,
          isAdmin,
          // Admins get AWCode enabled by default
          canUseAwcode: isAdmin,
        });
        return;
      }

      const data = await response.json();
      setPermissions(data);
    } catch (err: any) {
      console.error('[useUserPermissions] Failed to fetch permissions:', err);
      setError(err.message || 'Failed to fetch permissions');

      // Fallback to default with isAdmin from user
      const isAdmin = user?.is_admin ||
                      user?.groups?.includes('OpenAgenticAdmins') ||
                      user?.groups?.includes('admin') ||
                      false;

      setPermissions({
        ...DEFAULT_PERMISSIONS,
        isAdmin,
        canUseAwcode: isAdmin,
      });
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, getAccessToken, user]);

  // Fetch permissions on mount and when auth changes
  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  return {
    permissions,
    loading,
    error,
    refetch: fetchPermissions,
  };
};

export default useUserPermissions;
