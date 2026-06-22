/**
 * System Configuration Hook
 *
 * Fetches system configuration from the API.
 */

import { useState, useEffect } from 'react';
import { apiEndpoint } from '@/utils/api';

export interface WorkflowEngineConfig {
  type: 'native';
  name: string;
  available: boolean;
  url: string | null;
}

export interface SystemConfig {
  workflowEngine: WorkflowEngineConfig;
  /** How the platform was deployed — drives deploy-specific help (e.g. the
   *  login credential-help modal). Defaults to 'compose' when unknown. */
  deploymentMode: 'compose' | 'kubernetes';
  features: {
    // Core features - default enabled
    openagentic: boolean;
    mcp: boolean;
    vectorSearch: boolean;
    // Optional services - require explicit enabling
    ollama: boolean;
    multiModel: boolean;
    // Login "Need help signing in?" modal (set LOGIN_HELP_MODAL=false to hide).
    loginHelp: boolean;
    // 2026-04-19 — `slider` feature flag removed (task #144, slider rip).
  };
  version: string;
}

const DEFAULT_CONFIG: SystemConfig = {
  workflowEngine: {
    type: 'native',
    name: 'OpenAgentic Flows',
    available: true,
    url: null
  },
  deploymentMode: 'compose',
  features: {
    // Core features - default enabled
    openagentic: true,
    mcp: true,
    vectorSearch: true,
    // Optional services - default to enabled for development
    ollama: false,
    multiModel: true,
    // Login help modal default-on (matches the API default).
    loginHelp: true,
  },
  version: '1.0.0'
};

export function useSystemConfig() {
  const [config, setConfig] = useState<SystemConfig>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        setLoading(true);
        const response = await fetch(apiEndpoint('/system/config'));

        if (response.ok) {
          const data = await response.json();
          setConfig(data);
          setError(null);
        } else {
          // Use defaults if endpoint not available
          console.warn('System config endpoint not available, using defaults');
          setError(null);
        }
      } catch (err) {
        console.warn('Failed to fetch system config, using defaults:', err);
        setError(null);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, []);

  return { config, loading, error };
}

export default useSystemConfig;
