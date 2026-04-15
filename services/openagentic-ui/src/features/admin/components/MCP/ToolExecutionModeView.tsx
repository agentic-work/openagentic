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
 * Tool Execution Mode View
 *
 * Global read-only kill switch for MCP tools.
 * When enabled, all write operations (create, delete, update, restart, etc.) are blocked.
 * Read operations (list, get, describe, search) continue to work.
 * OAT (Tool Synthesis) is exempt -- it has its own HITL approval gate.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Shield, AlertTriangle, CheckCircle, Info } from 'lucide-react';
// ShieldAlert missing from lucide-react type defs — alias AlertTriangle
const ShieldAlert = AlertTriangle;

interface ToolExecutionModeViewProps {
  theme?: string;
}

export const ToolExecutionModeView: React.FC<ToolExecutionModeViewProps> = ({ theme }) => {
  const [readOnlyEnabled, setReadOnlyEnabled] = useState(false);
  const [settingSource, setSettingSource] = useState<'database' | 'env' | 'default'>('default');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState<'enable' | 'disable' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastChanged, setLastChanged] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true);
      const token = document.cookie.replace(/.*openagentic_token=([^;]*).*/, '$1');
      const res = await fetch('/api/admin/tools/readonly', {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setReadOnlyEnabled(data.enabled);
        setSettingSource(data.source || 'default');
        setLastChanged(data.lastChanged || null);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const handleToggle = () => {
    if (readOnlyEnabled) {
      // Disabling read-only (restoring full access) -- needs HITL confirmation
      setShowConfirmDialog('disable');
    } else {
      // Enabling read-only (kill switch) -- needs confirmation
      setShowConfirmDialog('enable');
    }
  };

  const confirmChange = async (newValue: boolean) => {
    try {
      setSaving(true);
      setError(null);
      const token = document.cookie.replace(/.*openagentic_token=([^;]*).*/, '$1');
      const res = await fetch('/api/admin/tools/readonly', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: newValue }),
      });
      if (res.ok) {
        setReadOnlyEnabled(newValue);
        setSettingSource('database');
        setLastChanged(new Date().toISOString());
      } else {
        const data = await res.json();
        setError(data.error || 'Failed to update setting');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
      setShowConfirmDialog(null);
    }
  };

  const isDark = theme !== 'light';

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className={`text-xl font-bold mb-2 ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Tool Execution Mode
        </h2>
        <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
          Control whether MCP tools can perform write operations. When read-only mode is active,
          tools that create, delete, modify, or restart resources are blocked. Read operations
          (list, get, describe, search) continue to work normally.
        </p>
      </div>

      {/* Status Card */}
      {!loading && (
        <div className={`rounded-lg border p-6 ${
          readOnlyEnabled
            ? isDark ? 'border-yellow-600/50 bg-yellow-900/20' : 'border-yellow-300 bg-yellow-50'
            : isDark ? 'border-green-600/50 bg-green-900/20' : 'border-green-300 bg-green-50'
        }`}>
          <div className="flex items-start gap-4">
            <div className={`p-3 rounded-full ${
              readOnlyEnabled
                ? isDark ? 'bg-yellow-900/50 text-yellow-400' : 'bg-yellow-100 text-yellow-600'
                : isDark ? 'bg-green-900/50 text-green-400' : 'bg-green-100 text-green-600'
            }`}>
              {readOnlyEnabled ? <ShieldAlert size={28} /> : <Shield size={28} />}
            </div>
            <div className="flex-1">
              <h3 className={`text-lg font-semibold mb-1 ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {readOnlyEnabled ? 'Read-Only Mode Active' : 'Full Access Mode'}
              </h3>
              <p className={`text-sm mb-3 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                {readOnlyEnabled
                  ? 'Write operations are blocked across all MCP tools. Only read operations (list, get, describe, search) are allowed.'
                  : 'All MCP tool operations are enabled, including write operations (create, delete, update, restart).'}
              </p>
              <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                Source: {settingSource === 'database' ? 'Admin Console (persisted)' : settingSource === 'env' ? 'Environment Variable' : 'System Default'}
                {lastChanged && ` | Last changed: ${new Date(lastChanged).toLocaleString()}`}
              </div>
            </div>
          </div>

          {/* Toggle Button */}
          <div className="mt-4 pt-4 border-t border-current/10">
            <button
              onClick={handleToggle}
              disabled={saving}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                readOnlyEnabled
                  ? isDark
                    ? 'bg-green-600 hover:bg-green-500 text-white'
                    : 'bg-green-600 hover:bg-green-700 text-white'
                  : isDark
                    ? 'bg-yellow-600 hover:bg-yellow-500 text-white'
                    : 'bg-yellow-600 hover:bg-yellow-700 text-white'
              } ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              {saving ? 'Updating...' : readOnlyEnabled ? 'Restore Full Access' : 'Enable Read-Only Mode'}
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className={`rounded-lg border p-6 ${isDark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'}`}>
          <p className={isDark ? 'text-gray-400' : 'text-gray-500'}>Loading tool execution mode...</p>
        </div>
      )}

      {error && (
        <div className={`rounded-lg border p-4 ${isDark ? 'border-red-600/50 bg-red-900/20' : 'border-red-300 bg-red-50'}`}>
          <p className={`text-sm ${isDark ? 'text-red-400' : 'text-red-600'}`}>{error}</p>
        </div>
      )}

      {/* Info Section */}
      <div className={`rounded-lg border p-4 ${isDark ? 'border-gray-700 bg-gray-800/50' : 'border-gray-200 bg-gray-50'}`}>
        <div className="flex items-start gap-3">
          <Info size={18} className={isDark ? 'text-blue-400 mt-0.5' : 'text-blue-600 mt-0.5'} />
          <div className={`text-sm ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
            <p className="font-medium mb-2">What is affected by read-only mode?</p>
            <div className="space-y-1 text-xs">
              <div className="flex items-center gap-2">
                <AlertTriangle size={12} className="text-yellow-500" />
                <span><strong>Blocked when active:</strong> create, delete, update, modify, restart, deploy, scale, patch operations</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle size={12} className="text-green-500" />
                <span><strong>Always allowed:</strong> list, get, describe, search, health, status, query operations</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle size={12} className="text-green-500" />
                <span><strong>Not affected:</strong> OAT (Tool Synthesis) has its own HITL approval gate</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Dialogs */}
      {showConfirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className={`rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl ${isDark ? 'bg-gray-800 border border-gray-700' : 'bg-white border border-gray-200'}`}>
            <div className="flex items-center gap-3 mb-4">
              <AlertTriangle size={24} className="text-yellow-500" />
              <h3 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>
                {showConfirmDialog === 'enable' ? 'Enable Read-Only Mode?' : 'Restore Full Tool Access?'}
              </h3>
            </div>

            {showConfirmDialog === 'enable' ? (
              <div className={`text-sm space-y-3 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                <p>This will immediately <strong>block all MCP tools</strong> that perform write operations:</p>
                <ul className="list-disc ml-5 space-y-1 text-xs">
                  <li>Creating and deleting cloud resources (VMs, storage, databases)</li>
                  <li>Restarting Kubernetes deployments and pods</li>
                  <li>Modifying security groups and network configurations</li>
                </ul>
                <p className="text-xs">Read-only tools (list, get, describe, search) will continue to work.
                  OAT (Tool Synthesis) is not affected.</p>
                <p className={`text-xs font-medium ${isDark ? 'text-yellow-400' : 'text-yellow-600'}`}>
                  Any running workflows using write tools will fail at the next write step.</p>
              </div>
            ) : (
              <div className={`text-sm space-y-3 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                <p>This will <strong>re-enable ALL write operations</strong> for MCP tools including:</p>
                <ul className="list-disc ml-5 space-y-1 text-xs">
                  <li>Create, delete, and modify cloud resources</li>
                  <li>Restart and scale Kubernetes workloads</li>
                  <li>Modify security configurations</li>
                </ul>
                <p className={`text-xs font-medium ${isDark ? 'text-red-400' : 'text-red-600'}`}>
                  Are you sure you want to restore full write access?</p>
              </div>
            )}

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setShowConfirmDialog(null)}
                className={`px-4 py-2 rounded-md text-sm ${isDark ? 'bg-gray-700 hover:bg-gray-600 text-gray-300' : 'bg-gray-200 hover:bg-gray-300 text-gray-700'}`}
              >
                Cancel
              </button>
              <button
                onClick={() => confirmChange(showConfirmDialog === 'enable')}
                disabled={saving}
                className={`px-4 py-2 rounded-md text-sm font-medium text-white ${
                  showConfirmDialog === 'enable'
                    ? 'bg-yellow-600 hover:bg-yellow-500'
                    : 'bg-red-600 hover:bg-red-500'
                } ${saving ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {saving ? 'Updating...' : showConfirmDialog === 'enable' ? 'Enable Read-Only Mode' : 'I understand, restore full access'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ToolExecutionModeView;
