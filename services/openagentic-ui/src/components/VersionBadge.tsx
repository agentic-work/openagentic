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
 * VersionBadge Component
 *
 * Displays the platform version and service status in a compact badge.
 * Always visible in the UI to show current platform version.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ServiceStatus {
  version: string;
  status: 'online' | 'offline' | 'degraded';
}

interface VersionData {
  version: string;
  environment: string;
  services: Record<string, ServiceStatus>;
}

interface ServiceDetail {
  name: string;
  version: string;
  gitCommit?: string;
  gitShortCommit?: string;
  status: 'online' | 'offline' | 'unknown';
  endpoint?: string;
  lastChecked?: string;
}

interface FullVersionData {
  platform: {
    name: string;
    version: string;
    environment: string;
    buildTime: string;
    gitCommit: string;
    gitBranch: string;
  };
  services: ServiceDetail[];
  timestamp: string;
}

const STATUS_COLORS = {
  online: 'bg-green-500',
  offline: 'bg-red-500',
  degraded: 'bg-yellow-500',
  unknown: 'bg-gray-500',
};

const STATUS_TEXT_COLORS = {
  online: 'text-green-400',
  offline: 'text-red-400',
  degraded: 'text-yellow-400',
  unknown: 'text-gray-400',
};

export const VersionBadge: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [versionData, setVersionData] = useState<VersionData | null>(null);
  const [fullData, setFullData] = useState<FullVersionData | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVersion = useCallback(async () => {
    try {
      const response = await fetch('/api/version/badge');
      if (response.ok) {
        const data = await response.json();
        setVersionData(data);
        setError(null);
      } else {
        setError('Failed to fetch version');
      }
    } catch (err) {
      setError('Version unavailable');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchFullVersion = useCallback(async () => {
    try {
      const response = await fetch('/api/version/all');
      if (response.ok) {
        const data = await response.json();
        setFullData(data);
      }
    } catch (err) {
      console.error('Failed to fetch full version data:', err);
    }
  }, []);

  useEffect(() => {
    fetchVersion();
    // Refresh version every 60 seconds
    const interval = setInterval(fetchVersion, 60000);
    return () => clearInterval(interval);
  }, [fetchVersion]);

  useEffect(() => {
    if (isExpanded && !fullData) {
      fetchFullVersion();
    }
  }, [isExpanded, fullData, fetchFullVersion]);

  const getOverallStatus = (): 'online' | 'offline' | 'degraded' => {
    if (!versionData?.services) return 'unknown' as any;
    const statuses = Object.values(versionData.services);
    if (statuses.every(s => s.status === 'online')) return 'online';
    if (statuses.some(s => s.status === 'offline')) return 'degraded';
    return 'online';
  };

  const overallStatus = getOverallStatus();

  if (isLoading) {
    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 bg-gray-800/50 rounded-full ${className}`}>
        <div className="w-2 h-2 rounded-full bg-gray-500 animate-pulse" />
        <span className="text-xs text-gray-400">Loading...</span>
      </div>
    );
  }

  if (error || !versionData) {
    const fallbackVersion = import.meta.env.VITE_APP_VERSION || import.meta.env.VITE_VERSION || 'dev';
    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 bg-gray-800/50 rounded-full ${className}`}>
        <div className="w-2 h-2 rounded-full bg-gray-500" />
        <span className="text-xs text-gray-400">v{fallbackVersion}</span>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`}>
      {/* Main Badge */}
      <motion.button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 px-3 py-1.5 bg-gray-800/50 hover:bg-gray-700/50 rounded-full transition-colors cursor-pointer border border-gray-700/50"
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        <div className={`w-2 h-2 rounded-full ${STATUS_COLORS[overallStatus]}`} />
        <span className="text-xs font-medium text-gray-200">
          v{versionData.version}
        </span>
        <span className="text-xs text-gray-500">
          {versionData.environment === 'production' ? 'prod' : versionData.environment}
        </span>
        <svg
          className={`w-3 h-3 text-gray-400 transition-transform ${isExpanded ? '' : 'rotate-180'}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </motion.button>

      {/* Expanded Panel - opens upward from bottom left */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 bottom-full mb-2 w-80 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="px-4 py-3 bg-gray-800/50 border-b border-gray-700">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">OpenAgentic Platform</h3>
                  <p className="text-xs text-gray-400">Version {versionData.version}</p>
                </div>
                <div className={`px-2 py-0.5 rounded text-xs font-medium ${
                  overallStatus === 'online' ? 'bg-green-900/50 text-green-400' :
                  overallStatus === 'degraded' ? 'bg-yellow-900/50 text-yellow-400' :
                  'bg-red-900/50 text-red-400'
                }`}>
                  {overallStatus === 'online' ? 'All Systems Operational' :
                   overallStatus === 'degraded' ? 'Partial Outage' : 'System Issues'}
                </div>
              </div>
            </div>

            {/* Services List */}
            <div className="px-4 py-3 space-y-2 max-h-64 overflow-y-auto">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Services</p>

              {fullData?.services ? (
                fullData.services.map((service) => {
                  const sha = service.gitShortCommit || service.gitCommit || '';
                  const shaDisplay =
                    sha && sha !== 'unknown' && sha !== 'upstream'
                      ? sha.length > 8 ? sha.slice(0, 8) : sha
                      : sha === 'upstream' ? 'upstream' : '';
                  return (
                    <div key={service.name} className="flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_COLORS[service.status] || STATUS_COLORS.unknown}`} />
                        <span className="text-sm text-gray-300 truncate">{service.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-gray-500">v{service.version}</span>
                        {shaDisplay && (
                          <code
                            className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 font-mono"
                            title={service.gitCommit || sha}
                          >
                            {shaDisplay}
                          </code>
                        )}
                        <span className={`text-xs ${STATUS_TEXT_COLORS[service.status] || STATUS_TEXT_COLORS.unknown}`}>
                          {service.status}
                        </span>
                      </div>
                    </div>
                  );
                })
              ) : versionData.services ? (
                Object.entries(versionData.services).map(([name, service]) => (
                  <div key={name} className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[service.status]}`} />
                      <span className="text-sm text-gray-300">{name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500">v{service.version}</span>
                      <span className={`text-xs ${STATUS_TEXT_COLORS[service.status]}`}>
                        {service.status}
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-xs text-gray-500">Loading services...</p>
              )}
            </div>

            {/* Footer */}
            {fullData?.platform && (
              <div className="px-4 py-2 bg-gray-800/30 border-t border-gray-700">
                <div className="flex items-center justify-between text-xs text-gray-500">
                  <span>Build: {fullData.platform.buildTime?.split('T')[0] || 'unknown'}</span>
                  <span>Commit: {fullData.platform.gitCommit?.slice(0, 7) || 'unknown'}</span>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Click outside to close */}
      {isExpanded && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsExpanded(false)}
        />
      )}
    </div>
  );
};

export default VersionBadge;
