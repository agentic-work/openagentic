/**
 * API Health Check Service
 * Pure frontend service for checking API availability
 * This is the ONLY service that should exist in the UI - it just checks if API is alive
 */

import { apiEndpoint } from '@/utils/api';

export interface ApiHealthStatus {
  isHealthy: boolean;
  isReachable: boolean;
  error?: string;
  services?: {
    auth?: boolean;
    database?: boolean;
    milvus?: boolean;
    azure_ad?: boolean;
  };
}

class ApiHealthService {
  private healthCheckTimeout = 5000; // 5 seconds

  /**
   * Check if the API is healthy and reachable
   * This should be the ONLY API call the UI makes without authentication
   */
  async checkHealth(): Promise<ApiHealthStatus> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.healthCheckTimeout);

      const response = await fetch(apiEndpoint('/health'), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'X-OpenAgentic-Frontend': import.meta.env.VITE_FRONTEND_SECRET || '',
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const healthData = await response.json();
        return {
          isHealthy: true,
          isReachable: true,
          services: healthData.services || {}
        };
      } else {
        return {
          isHealthy: false,
          isReachable: true,
          error: `API returned status ${response.status}`
        };
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return {
          isHealthy: false,
          isReachable: false,
          error: 'API health check timed out - API may be down'
        };
      }

      return {
        isHealthy: false,
        isReachable: false,
        error: error instanceof Error ? error.message : 'Network error - API is unreachable'
      };
    }
  }

  /**
   * Quick check if API is reachable (faster, less detailed)
   */
  async isApiReachable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 seconds for quick check

      await fetch(apiEndpoint('/health'), {
        method: 'HEAD',
        headers: {
          'X-OpenAgentic-Frontend': import.meta.env.VITE_FRONTEND_SECRET || '',
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return true;
    } catch {
      return false;
    }
  }
}

export const apiHealthService = new ApiHealthService();