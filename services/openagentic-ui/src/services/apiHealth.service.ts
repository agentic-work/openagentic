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