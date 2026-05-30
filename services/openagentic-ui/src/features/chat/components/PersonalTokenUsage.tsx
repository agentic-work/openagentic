/**
 * Personal Token Usage Component - Pure UI Presentation Layer
 * 
 * This component ONLY handles UI display and user interactions.
 * ALL business logic, calculations, and data processing happens on the API.
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Activity, TrendingUp, Calendar, DollarSign, X } from '@/shared/icons';
import clsx from 'clsx';
import { useAuth } from '@/app/providers/AuthContext';
import { apiEndpoint } from '@/utils/api';

// API Response Types - exactly as returned by the API
interface TokenUsageApiResponse {
  // All calculations done by API
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCost: number;
  sessionsToday: number;
  tokensToday: number;
  avgTokensPerMessage: number;
  // API handles all formatting
  formattedTotalTokens: string;  // e.g., "1.2K", "2.5M"
  formattedTotalCost: string;    // e.g., "$0.0123"
  formattedPromptTokens: string;
  formattedCompletionTokens: string;
  formattedAvgTokens: string;
  formattedTokensToday: string;
}

interface PersonalTokenUsageProps {
  theme: 'light' | 'dark';
  isOpen: boolean;
  onClose: () => void;
  globalData?: {
    total: number;
    sessions: number;
    users: number;
    cost: number;
    // API provides formatted versions
    formattedTotal: string;
    formattedCost: string;
  };
  isAdmin?: boolean;
}

// Helper function to format token counts
const formatTokenCount = (count: number): string => {
  if (count >= 1000000) {
    return `${(count / 1000000).toFixed(1)}M`;
  } else if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}K`;
  }
  return count.toString();
};

const PersonalTokenUsage: React.FC<PersonalTokenUsageProps> = ({
  theme,
  isOpen,
  onClose,
  globalData,
  isAdmin = false,
}) => {
  const { getAccessToken } = useAuth();
  const [stats, setStats] = useState<TokenUsageApiResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Simple data fetching - no business logic
  useEffect(() => {
    if (isOpen && !stats && !globalData) {
      fetchUsageData();
    }
  }, [isOpen, globalData]);

  const fetchUsageData = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const token = await getAccessToken(['User.Read']);
      if (!token) {
        throw new Error('No access token available');
      }

      // API endpoint handles ALL business logic:
      // - Token calculations and aggregations
      // - Cost calculations with proper rates
      // - Number formatting (K, M suffixes)
      // - Currency formatting
      // - Time-based filtering (today vs all-time)
      // - Admin vs user permission logic
      const response = await fetch(apiEndpoint('/analytics/my-usage'), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Map the API response to the expected format
      const mappedStats: TokenUsageApiResponse = {
        totalTokens: data.summary?.totalTokens || 0,
        promptTokens: data.summary?.promptTokens || 0,
        completionTokens: data.summary?.completionTokens || 0,
        totalCost: data.summary?.totalCost || 0,
        sessionsToday: data.summary?.totalRequests || 0,
        tokensToday: data.trends?.daily?.[data.trends.daily.length - 1]?.tokens || 0,
        avgTokensPerMessage: Math.round((data.summary?.totalTokens || 0) / Math.max(1, data.summary?.totalRequests || 1)),

        // Format the values for display
        formattedTotalTokens: formatTokenCount(data.summary?.totalTokens || 0),
        formattedTotalCost: `$${(data.summary?.totalCost || 0).toFixed(4)}`,
        formattedPromptTokens: formatTokenCount(data.summary?.promptTokens || 0),
        formattedCompletionTokens: formatTokenCount(data.summary?.completionTokens || 0),
        formattedAvgTokens: formatTokenCount(Math.round((data.summary?.totalTokens || 0) / Math.max(1, data.summary?.totalRequests || 1))),
        formattedTokensToday: formatTokenCount(data.trends?.daily?.[data.trends.daily.length - 1]?.tokens || 0),
      };

      setStats(mappedStats);
    } catch (err) {
      console.error('Failed to fetch usage data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load usage data');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40"
            onClick={onClose}
          />
          
          {/* Dropdown Panel */}
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className={clsx(
              'absolute bottom-full mb-2 right-0 z-50',
              'w-80 p-4 rounded-lg border shadow-xl',
              'bg-bg-primary border-border-primary'
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Activity className={clsx(
                  'w-5 h-5',
                  'text-blue-500 light:text-blue-600'
                )} />
                <h3 className={clsx(
                  'font-semibold',
                  'text-text-primary'
                )}>
                  {isAdmin ? 'Global Token Usage' : 'Personal Token Usage'}
                </h3>
              </div>
              <button
                onClick={onClose}
                className={clsx(
                  'p-1 rounded-md transition-colors',
                  'hover:bg-bg-secondary text-text-muted hover:text-text-secondary'
                )}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Loading State */}
            {isLoading && (
              <div className="flex items-center justify-center py-8">
                <div className={clsx(
                  'animate-spin rounded-full h-8 w-8 border-2 border-b-transparent',
                  'border-blue-500 light:border-blue-600'
                )} />
              </div>
            )}

            {/* Error State */}
            {error && (
              <div className={clsx(
                'p-3 rounded-lg border text-sm',
                'bg-red-900/20 light:bg-red-50 border-red-800 light:border-red-200 text-red-400 light:text-red-600'
              )}>
                {error}
              </div>
            )}

            {/* Data Display - Pure Presentation */}
            {(stats || globalData) && !isLoading && (
              <div className="space-y-4">
                {/* Total Usage - Display Pre-Formatted Data from API */}
                <div className={clsx(
                  'p-3 rounded-lg border',
                  'bg-bg-secondary border-border-primary'
                )}>
                  <div className="flex items-center gap-2 mb-2">
                    <TrendingUp className="w-4 h-4 text-green-500" />
                    <span className={clsx(
                      'text-sm font-medium',
                      'text-text-secondary'
                    )}>
                      All Time
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className={clsx(
                        'font-semibold text-lg',
                        'text-text-primary'
                      )}>
                        {/* Use pre-formatted values from API */}
{String(globalData?.formattedTotal || stats?.formattedTotalTokens || '0')}
                      </div>
                      <div className={clsx(
                        'text-xs',
                        'text-text-muted'
                      )}>
                        {isAdmin ? 'Platform Tokens' : 'Total Tokens'}
                      </div>
                    </div>
                    <div>
                      <div className={clsx(
                        'font-semibold text-lg',
                        'text-text-primary'
                      )}>
                        {/* Use pre-formatted currency from API */}
{String(globalData?.formattedCost || stats?.formattedTotalCost || '$0.00')}
                      </div>
                      <div className={clsx(
                        'text-xs',
                        'text-text-muted'
                      )}>
                        {isAdmin ? 'Platform Cost' : 'Total Cost'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Today's Usage */}
                <div className={clsx(
                  'p-3 rounded-lg border',
                  'bg-blue-900/20 light:bg-blue-50 border-blue-800 light:border-blue-200'
                )}>
                  <div className="flex items-center gap-2 mb-2">
                    <Calendar className="w-4 h-4 text-blue-500" />
                    <span className={clsx(
                      'text-sm font-medium',
                      'text-blue-600 light:text-blue-700'
                    )}>
                      Today
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className={clsx(
                        'font-semibold',
                        'text-blue-600 light:text-blue-700'
                      )}>
{String(globalData?.sessions || stats?.sessionsToday || 0)}
                      </div>
                      <div className={clsx(
                        'text-xs',
                        'text-blue-500 light:text-blue-600'
                      )}>
                        {isAdmin ? 'Total Sessions' : 'Sessions Today'}
                      </div>
                    </div>
                    <div>
                      <div className={clsx(
                        'font-semibold',
                        'text-blue-600 light:text-blue-700'
                      )}>
                        {/* Display pre-formatted data */}
{String(globalData ? globalData.users : (stats?.formattedTokensToday || '0'))}
                      </div>
                      <div className={clsx(
                        'text-xs',
                        'text-blue-500 light:text-blue-600'
                      )}>
                        {isAdmin ? 'Active Users' : 'Tokens Today'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Token Breakdown - Only for Personal Usage */}
                {!isAdmin && stats && (
                  <div className="space-y-2">
                    <h4 className={clsx(
                      'text-sm font-medium',
                      'text-text-secondary'
                    )}>
                      Token Breakdown
                    </h4>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className={clsx('text-text-muted')}>
                          Input Tokens:
                        </span>
                        <span className={clsx('font-medium text-text-primary')}>
{String(stats.formattedPromptTokens)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className={clsx('text-text-muted')}>
                          Output Tokens:
                        </span>
                        <span className={clsx('font-medium text-text-primary')}>
{String(stats.formattedCompletionTokens)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className={clsx('text-text-muted')}>
                          Avg per Message:
                        </span>
                        <span className={clsx('font-medium text-text-primary')}>
{String(stats.formattedAvgTokens)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Refresh Button */}
                {!globalData && (
                  <button
                    onClick={fetchUsageData}
                    disabled={isLoading}
                    className={clsx(
                      'w-full py-2 px-3 rounded-lg text-sm font-medium transition-colors',
                      'bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 :bg-blue-700 :bg-blue-800 light:bg-blue-500 light:hover:bg-blue-600 light:disabled:bg-blue-300 text-white'
                    )}
                  >
                    {isLoading ? 'Refreshing...' : 'Refresh'}
                  </button>
                )}
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default PersonalTokenUsage;