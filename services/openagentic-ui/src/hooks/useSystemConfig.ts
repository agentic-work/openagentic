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
  features: {
    // Core features - default enabled
    openagentic: boolean;
    mcp: boolean;
    vectorSearch: boolean;
    // Optional services - require explicit enabling
    ollama: boolean;
    multiModel: boolean;
    slider: boolean;
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
  features: {
    // Core features - default enabled
    openagentic: true,
    mcp: true,
    vectorSearch: true,
    // Optional services - default to enabled for development
    ollama: false,
    multiModel: true,
    slider: true
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
