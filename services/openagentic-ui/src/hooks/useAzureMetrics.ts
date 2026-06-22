/**
 * Azure Metrics Hook
 * Provides methods for interacting with Azure Monitor API
 * Uses Service Principal authentication via backend proxy
 */

import { useState, useCallback } from 'react';
import { useAuth } from '@/app/providers/AuthContext';

export interface AzureResourceInfo {
  subscriptionId: string;
  resourceGroup: string;
  accountName: string;
  deployments: Array<{
    name: string;
    model: string;
    version: string;
    capacity: number;
    scaleType: string;
  }>;
  endpoint: string;
  location: string;
}

export interface MetricQuery {
  subscriptionId: string;
  resourceGroup: string;
  accountName: string;
  metricNames?: string[];
  startTime: Date;
  endTime: Date;
  interval?: string; // PT1M, PT5M, PT1H, etc.
  aggregation?: 'Total' | 'Average' | 'Count' | 'Maximum' | 'Minimum';
  filter?: string;
  deployment?: string;
}

export interface MetricResult {
  name: string;
  displayName: string;
  unit: string;
  timeseries: Array<{
    metadataValues?: Array<{ name: string; value: string }>;
    data: Array<{
      timeStamp: string;
      total?: number;
      average?: number;
      count?: number;
      maximum?: number;
      minimum?: number;
    }>;
  }>;
}

export interface TokenUsageData {
  timestamp: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
  model: string;
  deploymentName: string;
  estimatedCost: number;
}

export interface CostAnalysis {
  totalCost: number;
  costByModel: Map<string, number>;
  costByDeployment: Map<string, number>;
  costTrend: Array<{ date: string; cost: number }>;
  projectedMonthlyCost: number;
}

export const useAzureMetrics = () => {
  const { getAuthHeaders } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get Azure OpenAI resource information
  const getResourceInfo = useCallback(async (): Promise<AzureResourceInfo | null> => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/admin/azure/resource-info', { 
        headers,
        method: 'GET'
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch Azure resource info');
      }
      
      return await response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get resource info';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  // Query Azure Monitor metrics
  const queryMetrics = useCallback(async (query: MetricQuery): Promise<MetricResult[]> => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      
      // Default metric names for Azure OpenAI
      const metricNames = query.metricNames || [
        'ProcessedPromptTokens',
        'GeneratedCompletionTokens',
        'TokenTransaction',
        'ActiveRequests',
        'SuccessfulRequests',
        'ModelUtilization',
        'RequestLatency'
      ];

      const params = new URLSearchParams({
        subscriptionId: query.subscriptionId,
        resourceGroup: query.resourceGroup,
        accountName: query.accountName,
        startTime: query.startTime.toISOString(),
        endTime: query.endTime.toISOString(),
        metricNames: metricNames.join(','),
        interval: query.interval || 'PT5M',
        aggregation: query.aggregation || 'Total'
      });

      if (query.filter) params.append('filter', query.filter);
      if (query.deployment) params.append('deployment', query.deployment);

      const response = await fetch(`/api/admin/azure/metrics?${params}`, {
        headers,
        method: 'GET'
      });
      
      if (!response.ok) {
        throw new Error('Failed to query Azure metrics');
      }
      
      const data = await response.json();
      return data.metrics || [];
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to query metrics';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  // Get token usage data
  const getTokenUsage = useCallback(async (
    startTime: Date,
    endTime: Date,
    deployment?: string
  ): Promise<TokenUsageData[]> => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString()
      });
      
      if (deployment) params.append('deployment', deployment);

      const response = await fetch(`/api/admin/azure/token-usage?${params}`, {
        headers,
        method: 'GET'
      });
      
      if (!response.ok) {
        throw new Error('Failed to get token usage');
      }
      
      return await response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get token usage';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  // Get cost analysis
  const getCostAnalysis = useCallback(async (
    startTime: Date,
    endTime: Date
  ): Promise<CostAnalysis> => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString()
      });

      const response = await fetch(`/api/admin/azure/cost-analysis?${params}`, {
        headers,
        method: 'GET'
      });
      
      if (!response.ok) {
        throw new Error('Failed to get cost analysis');
      }
      
      return await response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get cost analysis';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  // Get deployment metrics
  const getDeploymentMetrics = useCallback(async (
    deploymentName: string,
    startTime: Date,
    endTime: Date
  ): Promise<any> => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({
        deployment: deploymentName,
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString()
      });

      const response = await fetch(`/api/admin/azure/deployment-metrics?${params}`, {
        headers,
        method: 'GET'
      });
      
      if (!response.ok) {
        throw new Error('Failed to get deployment metrics');
      }
      
      return await response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get deployment metrics';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  // Export metrics to CSV/Excel
  const exportMetrics = useCallback(async (
    startTime: Date,
    endTime: Date,
    format: 'csv' | 'excel' = 'csv'
  ): Promise<Blob> => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const params = new URLSearchParams({
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        format
      });

      const response = await fetch(`/api/admin/azure/metrics/export?${params}`, {
        headers,
        method: 'GET'
      });
      
      if (!response.ok) {
        throw new Error('Failed to export metrics');
      }
      
      return await response.blob();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to export metrics';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  // Set up cost alerts
  const setCostAlert = useCallback(async (
    threshold: number,
    period: 'daily' | 'weekly' | 'monthly',
    emails: string[]
  ): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/admin/azure/cost-alerts', {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          threshold,
          period,
          emails
        })
      });
      
      if (!response.ok) {
        throw new Error('Failed to set cost alert');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to set cost alert';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  // Get quota and limits
  const getQuotaInfo = useCallback(async (): Promise<any> => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/admin/azure/quota', {
        headers,
        method: 'GET'
      });
      
      if (!response.ok) {
        throw new Error('Failed to get quota info');
      }
      
      return await response.json();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get quota info';
      setError(message);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [getAuthHeaders]);

  return {
    loading,
    error,
    getResourceInfo,
    queryMetrics,
    getTokenUsage,
    getCostAnalysis,
    getDeploymentMetrics,
    exportMetrics,
    setCostAlert,
    getQuotaInfo
  };
};