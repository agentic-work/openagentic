import React, { useState, useEffect } from 'react';
import { Activity, X } from '@/shared/icons';

// Storage service helper - inline since the module was removed
const storageService = {
  getAuthToken: async (): Promise<string | null> => {
    return localStorage.getItem('auth_token');
  }
};

interface LiveUsagePanelProps {
  isOpen: boolean;
  onClose: () => void;
  theme: 'light' | 'dark';
}

interface UsageData {
  currentTokens: number;
  sessionTokens: number;
  cost: number;
  requests: number;
}

const LiveUsagePanel: React.FC<LiveUsagePanelProps> = ({ isOpen, onClose, theme }) => {
  const [usageData, setUsageData] = useState<UsageData>({
    currentTokens: 0,
    sessionTokens: 0,
    cost: 0.00,
    requests: 0
  });

  useEffect(() => {
    if (isOpen) {
      // Fetch live usage data from API
      const fetchUsageData = async () => {
        try {
          const token = await storageService.getAuthToken();

          // Fetch usage data from database
          const response = await fetch('/admin/my-usage', {
            headers: {
              'Authorization': `Bearer ${token}`
            }
          });
          
          if (response.ok) {
            const data = await response.json();
            setUsageData({
              currentTokens: data.tokens?.current || 0,
              sessionTokens: data.tokens?.session || 0,
              cost: data.cost?.total || 0.00,
              requests: data.requests?.count || 0
            });
          }
        } catch (error) {
          console.error('Failed to fetch usage data:', error);
        }
      };

      fetchUsageData();
      const interval = setInterval(fetchUsageData, 5000); // Update every 5 seconds

      return () => clearInterval(interval);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div 
    className="absolute bottom-full left-0 mb-2 border rounded-lg shadow-lg p-4 w-64 z-50"
    style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-green-500" />
          <h3 className="text-sm font-semibold">Live Usage</h3>
        </div>
        <button 
          onClick={onClose}
          
          className="hover:text-gray-600 :text-gray-300"
          style={{ color: 'var(--color-textMuted)' }}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      
      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span style={{ color: 'var(--color-textSecondary)' }}>Current:</span>
          <span className="font-mono">{usageData.currentTokens.toLocaleString()} tokens</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: 'var(--color-textSecondary)' }}>Session:</span>
          <span className="font-mono">{usageData.sessionTokens.toLocaleString()} tokens</span>
        </div>
        <div className="flex justify-between">
          <span style={{ color: 'var(--color-textSecondary)' }}>Requests:</span>
          <span className="font-mono">{usageData.requests}</span>
        </div>
        <div 
        className="flex justify-between pt-2 border-t"
        style={{ borderColor: 'var(--color-border)' }}>
          <span style={{ color: 'var(--color-textSecondary)' }}>Cost:</span>
          <span className="font-mono text-green-600">${usageData.cost.toFixed(4)}</span>
        </div>
      </div>
    </div>
  );
};

export default LiveUsagePanel;