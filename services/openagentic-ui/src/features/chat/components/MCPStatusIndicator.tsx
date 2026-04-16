import React, { useState, useEffect } from 'react';
import { Activity, AlertCircle, CheckCircle, Loader, Server } from '@/shared/icons';
import { motion, AnimatePresence } from 'framer-motion';
import { apiEndpoint } from '@/utils/api';
import { useAuth } from '@/app/providers/AuthContext';
import { useTheme } from '@/contexts/ThemeContext';

interface MCPStatus {
  total: number;
  available: number;
  active: number;
  tools: number;
  servers: string[];
}

export const MCPStatusIndicator: React.FC = () => {
  const [status, setStatus] = useState<MCPStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const { getAuthHeaders, user } = useAuth();
  const { resolvedTheme } = useTheme();

  const fetchMCPStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const headers = await getAuthHeaders();
      
      // Get MCP tools
      const toolsResponse = await fetch(apiEndpoint('/mcp/tools'), {
        headers
      });
      
      if (!toolsResponse.ok) {
        throw new Error('Failed to fetch MCP tools');
      }
      
      const toolsData = await toolsResponse.json();
      const tools = toolsData.tools || [];
      
      // Get MCP instances
      const instancesResponse = await fetch(apiEndpoint('/mcp/user-instances'), {
        headers
      });
      
      const instancesData = instancesResponse.ok ? await instancesResponse.json() : { instances: [] };
      const instances = instancesData.instances || [];
      
      // Extract unique server IDs
      const serverIds = [...new Set(tools.map((t: any) => t.serverId))] as string[];
      const activeInstances = instances.filter((i: any) => i.status === 'active');
      
      setStatus({
        total: serverIds.length,
        available: serverIds.length,
        active: activeInstances.length,
        tools: tools.length,
        servers: serverIds
      });
    } catch (err) {
      console.error('Failed to fetch MCP status:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch MCP status');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMCPStatus();
    // Refresh every 30 seconds
    const interval = setInterval(fetchMCPStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = () => {
    if (loading) return 'text-yellow-500';
    if (error || !status || status.tools === 0) return 'text-red-500';
    if (status.tools > 0) return 'text-green-500';
    return 'text-gray-500';
  };

  const getStatusIcon = () => {
    if (loading) return <Loader className="animate-spin" size={16} />;
    if (error || !status || status.tools === 0) return <AlertCircle size={16} />;
    return <CheckCircle size={16} />;
  };

  const getStatusText = () => {
    if (loading) return 'Loading MCP...';
    if (error) return 'MCP Error';
    if (!status || status.tools === 0) return 'No MCP Tools';
    return `${status.tools} MCP Tools`;
  };

  return (
    <div className="relative">
      <motion.button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border transition-colors ${getStatusColor()}`}
        style={{
          backgroundColor: 'var(--color-surface)',
          borderColor: 'var(--color-border)'
        }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
      >
        {getStatusIcon()}
        <span className="text-sm font-medium">{getStatusText()}</span>
        {status && status.tools > 0 && (
          <span
          className="text-xs"
          style={{ color: 'var(--color-textMuted)' }}>
            ({status.active} active)
          </span>
        )}
      </motion.button>

      <AnimatePresence>
        {isExpanded && status && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            
            className="absolute top-full mt-2 right-0 w-80 p-4 border rounded-lg shadow-xl z-50"
            style={{ backgroundColor: 'var(--color-background)', borderColor: 'var(--color-borderHover)' }}
          >
            <div className="flex items-center justify-between mb-3">
              <h3 
              className="text-sm font-semibold flex items-center gap-2"
              style={{ color: 'var(--color-text)' }}>
                <Server size={16} />
                MCP Status
              </h3>
              <button
                onClick={() => setIsExpanded(false)}
                
                className="hover:text-white"
                style={{ color: 'var(--color-textMuted)' }}
              >
                ×
              </button>
            </div>
            
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span style={{ color: 'var(--color-textMuted)' }}>Total Servers:</span>
                <span 
                className="font-medium"
                style={{ color: 'var(--color-text)' }}>{status.total}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span style={{ color: 'var(--color-textMuted)' }}>Available Tools:</span>
                <span className="text-green-400 font-medium">{status.tools}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span style={{ color: 'var(--color-textMuted)' }}>Active Instances:</span>
                <span className="text-blue-400 font-medium">{status.active}</span>
              </div>
              
              {status.servers.length > 0 && (
                <div 
                className="mt-3 pt-3 border-t"
                style={{ borderColor: 'var(--color-borderHover)' }}>
                  <div 
                  className="text-xs mb-2"
                  style={{ color: 'var(--color-textMuted)' }}>Available Servers:</div>
                  <div className="space-y-1">
                    {status.servers.map(server => (
                      <div key={server} className="flex items-center gap-2 text-xs">
                        <Activity size={10} className="text-green-500" />
                        <span style={{ color: 'var(--color-textMuted)' }}>{server}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {user?.isAdmin && (
                <div 
                className="mt-3 pt-3 border-t"
                style={{ borderColor: 'var(--color-borderHover)' }}>
                  <button
                    onClick={() => window.location.href = '/mcp/dashboard'}
                    
                    className="w-full text-xs px-3 py-2 bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
                    style={{ color: 'var(--color-text)' }}
                  >
                    Open MCP Dashboard
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};