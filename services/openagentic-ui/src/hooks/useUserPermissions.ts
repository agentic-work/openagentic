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
  /** true = user has flows/workflow access granted. Admins always true. */
  workflowsEnabled: boolean;
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
  workflowsEnabled: false, // Flows disabled by default — admin grants per user
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
          // Admins get Flows enabled by default
          workflowsEnabled: isAdmin,
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
        workflowsEnabled: isAdmin,
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
