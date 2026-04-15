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
 * Synth Approvals View
 *
 * Admin interface for managing Synth tool approval requests.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  SuccessIcon, ErrorIcon, ClockIcon, WarningIcon, UserIcon, CodeIcon,
  RefreshIcon, EyeIcon, SuccessIcon as ThumbsUpIcon, ErrorIcon as ThumbsDownIcon
} from '../Shared/AdminIcons';
import { apiRequest } from '@/utils/api';

interface PendingApproval {
  id: string;
  toolId: string;
  userId: string;
  userEmail: string;
  intent: string;
  riskLevel: string;
  code: string;
  createdAt: string;
  expiresAt: string;
}

interface OATApprovalsViewProps {
  theme: string;
}

export const OATApprovalsView: React.FC<OATApprovalsViewProps> = ({ theme }) => {
  const [approvals, setApprovals] = useState<PendingApproval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedApproval, setSelectedApproval] = useState<PendingApproval | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const fetchApprovals = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiRequest('/api/admin/synth/approvals');
      if (!response.ok) throw new Error('Failed to fetch approvals');
      const data = await response.json();
      setApprovals(data.approvals || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchApprovals();
  }, [fetchApprovals]);

  const handleApprove = async (id: string) => {
    setProcessingId(id);
    try {
      const response = await apiRequest(`/api/admin/synth/approvals/${id}/approve`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Approved by admin' }),
      });
      if (!response.ok) throw new Error('Failed to approve');
      await fetchApprovals();
      setSelectedApproval(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const handleReject = async (id: string) => {
    if (!rejectReason.trim()) {
      setError('Please provide a rejection reason');
      return;
    }
    setProcessingId(id);
    try {
      const response = await apiRequest(`/api/admin/synth/approvals/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason: rejectReason }),
      });
      if (!response.ok) throw new Error('Failed to reject');
      await fetchApprovals();
      setSelectedApproval(null);
      setRejectReason('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessingId(null);
    }
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'low': return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
      case 'medium': return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400';
      case 'high': return 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400';
      case 'critical': return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
      default: return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  };

  const isDark = theme === 'dark';
  const bgColor = isDark ? 'bg-gray-900' : 'bg-white';
  const textColor = isDark ? 'text-gray-100' : 'text-gray-900';
  const borderColor = isDark ? 'border-gray-700' : 'border-gray-200';
  const cardBg = isDark ? 'bg-gray-800' : 'bg-gray-50';

  if (loading) {
    return (
      <div className={`${bgColor} ${textColor} p-6 flex items-center justify-center min-h-[400px]`}>
        <RefreshIcon size={32} className="animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className={`${bgColor} ${textColor} p-6`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <ClockIcon size={24} className="text-orange-500" />
            Pending Approvals
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Review and approve/reject Synth tool synthesis requests
          </p>
        </div>
        <button
          onClick={fetchApprovals}
          className="p-2 rounded bg-blue-600 text-white hover:bg-blue-700"
        >
          <RefreshIcon size={16} />
        </button>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-4 p-4 bg-red-100 dark:bg-red-900/30 border border-red-400 rounded-lg flex items-center gap-2 text-red-700 dark:text-red-400">
          <ErrorIcon size={20} />
          {error}
          <button onClick={() => setError(null)} className="ml-auto">
            <ErrorIcon size={16} />
          </button>
        </div>
      )}

      {/* Approvals List */}
      {approvals.length === 0 ? (
        <div className={`${cardBg} p-8 rounded-lg border ${borderColor} text-center`}>
          <SuccessIcon size={48} className="text-green-500 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">All Caught Up!</h3>
          <p className="text-gray-500">No pending approvals at this time.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {approvals.map((approval) => (
            <div
              key={approval.id}
              className={`${cardBg} p-4 rounded-lg border ${borderColor}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-xs px-2 py-1 rounded font-medium ${getRiskColor(approval.riskLevel)}`}>
                      {approval.riskLevel.toUpperCase()} RISK
                    </span>
                    <span className="text-sm text-gray-500 flex items-center gap-1">
                      <UserIcon size={16} />
                      {approval.userEmail || approval.userId}
                    </span>
                  </div>
                  <h4 className="font-medium mb-1">{approval.intent}</h4>
                  <p className="text-sm text-gray-500">
                    Requested: {new Date(approval.createdAt).toLocaleString()}
                    {' | '}
                    Expires: {new Date(approval.expiresAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedApproval(approval)}
                    className="p-2 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600"
                    title="View Code"
                  >
                    <EyeIcon size={16} />
                  </button>
                  <button
                    onClick={() => handleApprove(approval.id)}
                    disabled={processingId === approval.id}
                    className="p-2 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                    title="Approve"
                  >
                    <ThumbsUpIcon size={16} />
                  </button>
                  <button
                    onClick={() => {
                      setSelectedApproval(approval);
                      setRejectReason('');
                    }}
                    disabled={processingId === approval.id}
                    className="p-2 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                    title="Reject"
                  >
                    <ThumbsDownIcon size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selectedApproval && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className={`${cardBg} rounded-lg shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden`}>
            <div className={`p-4 border-b ${borderColor} flex items-center justify-between`}>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <CodeIcon size={20} />
                Review Tool Code
              </h3>
              <button
                onClick={() => setSelectedApproval(null)}
                className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                <ErrorIcon size={20} />
              </button>
            </div>

            <div className="p-4 overflow-auto max-h-[50vh]">
              <div className="mb-4">
                <span className={`text-xs px-2 py-1 rounded font-medium ${getRiskColor(selectedApproval.riskLevel)}`}>
                  {selectedApproval.riskLevel.toUpperCase()} RISK
                </span>
              </div>
              <p className="text-sm mb-4">
                <strong>Intent:</strong> {selectedApproval.intent}
              </p>
              <div className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-auto">
                <pre className="text-sm font-mono whitespace-pre-wrap">
                  {selectedApproval.code}
                </pre>
              </div>
            </div>

            <div className={`p-4 border-t ${borderColor}`}>
              <div className="mb-4">
                <label className="block text-sm font-medium mb-1">
                  Rejection Reason (required for rejection)
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className={`w-full p-2 rounded border ${borderColor} ${cardBg}`}
                  rows={2}
                  placeholder="Explain why this tool should not be executed..."
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setSelectedApproval(null)}
                  className="px-4 py-2 rounded bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleReject(selectedApproval.id)}
                  disabled={processingId === selectedApproval.id || !rejectReason.trim()}
                  className="px-4 py-2 rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
                >
                  <ThumbsDownIcon size={16} />
                  Reject
                </button>
                <button
                  onClick={() => handleApprove(selectedApproval.id)}
                  disabled={processingId === selectedApproval.id}
                  className="px-4 py-2 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                >
                  <ThumbsUpIcon size={16} />
                  Approve
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OATApprovalsView;
