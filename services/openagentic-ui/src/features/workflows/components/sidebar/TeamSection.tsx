/**
 * TeamSection - Team sharing, permissions, and activity feed
 */

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Shield,
  Eye,
  Edit,
  Play,
  Clock,
  Activity,
  ExternalLink,
} from '@/shared/icons';
import { useAuth } from '@/app/providers/AuthContext';
import { workflowEndpoint } from '@/utils/api';

interface TeamSectionProps {
  workflowId?: string;
}

interface ShareEntry {
  id: string;
  user_id?: string;
  group_id?: string;
  name: string;
  email?: string;
  role: 'viewer' | 'editor' | 'executor' | 'admin';
  type: 'user' | 'group';
}

interface ActivityEntry {
  id: string;
  user_name: string;
  status: 'completed' | 'failed' | 'running';
  started_at: string;
  duration_ms?: number;
}

const roleColors: Record<string, string> = {
  viewer: 'var(--color-fg-muted)',
  editor: 'var(--color-info)',
  executor: 'var(--color-warning)',
  admin: 'var(--color-accent)',
};

const roleIcons: Record<string, React.ReactNode> = {
  viewer: <Eye className="w-3 h-3" />,
  editor: <Edit className="w-3 h-3" />,
  executor: <Play className="w-3 h-3" />,
  admin: <Shield className="w-3 h-3" />,
};

const statusColors: Record<string, string> = {
  completed: 'var(--color-success)',
  failed: 'var(--color-error)',
  running: 'var(--color-warning)',
};

export const TeamSection: React.FC<TeamSectionProps> = ({ workflowId }) => {
  const { getAuthHeaders } = useAuth();

  const [shares, setShares] = useState<ShareEntry[]>([]);
  const [owner, setOwner] = useState<string | null>(null);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch shares
  const fetchShares = useCallback(async () => {
    if (!workflowId) return;
    try {
      setLoading(true);
      const headers = getAuthHeaders();
      const res = await fetch(workflowEndpoint(`/workflows/${workflowId}/shares`), { headers });
      if (res.ok) {
        const data = await res.json();
        setShares(Array.isArray(data) ? data : data.shares || []);
        if (data.owner) setOwner(data.owner);
      }
    } catch {
      /* silently handle */
    } finally {
      setLoading(false);
    }
  }, [workflowId, getAuthHeaders]);

  // Fetch recent activity
  const fetchActivity = useCallback(async () => {
    if (!workflowId) return;
    try {
      const headers = getAuthHeaders();
      const res = await fetch(workflowEndpoint(`/workflows/${workflowId}/executions?limit=5`), { headers });
      if (res.ok) {
        const data = await res.json();
        const executions = Array.isArray(data) ? data : data.executions || [];
        setActivity(
          executions.slice(0, 5).map((ex: any) => ({
            id: ex.id,
            user_name: ex.user_name || ex.user_email || 'Unknown',
            status: ex.status,
            started_at: ex.started_at || ex.created_at,
            duration_ms: ex.duration_ms,
          }))
        );
      }
    } catch {
      /* silently handle */
    }
  }, [workflowId, getAuthHeaders]);

  useEffect(() => {
    fetchShares();
    fetchActivity();
  }, [fetchShares, fetchActivity]);

  if (!workflowId) {
    return (
      <div className="px-4 py-3 text-[12px]" style={{ color: 'var(--color-text-tertiary, #999)' }}>
        Save workflow first to manage team access
      </div>
    );
  }

  return (
    <div className="px-4 py-2 space-y-3">
      {/* Owner */}
      {owner && (
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary, #777)' }}>
            Owner
          </span>
          <span
            className="text-[11px] px-1.5 py-0.5 rounded-full font-medium"
            style={{
              backgroundColor: 'var(--glass-accent-fill-2)',
              color: 'var(--user-accent-primary, #FF5722)',
            }}
          >
            {owner}
          </span>
        </div>
      )}

      {/* Shared Users/Groups */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary, #777)' }}>
            Shared With
          </span>
          <button
            onClick={() => window.dispatchEvent(new CustomEvent('openShareDialog'))}
            className="text-[11px] font-medium transition-colors hover:opacity-80"
            style={{ color: 'var(--user-accent-primary, #FF5722)' }}
          >
            Share
          </button>
        </div>

        {loading ? (
          <div className="text-[12px] py-1" style={{ color: 'var(--color-text-tertiary, #999)' }}>
            Loading...
          </div>
        ) : shares.length === 0 ? (
          <div className="text-[12px] py-2 text-center" style={{ color: 'var(--color-text-tertiary, #999)' }}>
            <Users className="w-5 h-5 mx-auto mb-1" style={{ color: 'var(--color-text-tertiary, #777)' }} />
            No shares yet
          </div>
        ) : (
          <div className="space-y-1">
            {shares.map(share => (
              <div
                key={share.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded-[var(--ctl-radius-sm)] border border-transparent transition-[background,border-color] glass-row-hover"
              >
                <span className="flex-shrink-0">
                  {share.type === 'group' ? (
                    <Users className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary, #999)' }} />
                  ) : (
                    <span
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold"
                      style={{
                        backgroundColor: 'var(--color-surface)',
                        color: 'var(--color-text-secondary, #666)',
                      }}
                    >
                      {share.name.charAt(0).toUpperCase()}
                    </span>
                  )}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium truncate" style={{ color: 'var(--color-text)' }}>
                    {share.name}
                  </div>
                  {share.email && (
                    <div className="text-[10px] truncate" style={{ color: 'var(--color-text-tertiary, #999)' }}>
                      {share.email}
                    </div>
                  )}
                </div>
                <span
                  className="flex items-center gap-0.5 text-[10px] px-1 py-0.5 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor: `${roleColors[share.role]}20`,
                    color: roleColors[share.role],
                  }}
                >
                  {roleIcons[share.role]}
                  {share.role}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Activity Feed */}
      <div>
        <div className="flex items-center gap-1 mb-1.5">
          <Activity className="w-3 h-3" style={{ color: 'var(--color-text-tertiary, #777)' }} />
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary, #777)' }}>
            Recent Activity
          </span>
        </div>
        {activity.length === 0 ? (
          <div className="text-[12px] py-1" style={{ color: 'var(--color-text-tertiary, #999)' }}>
            No executions yet
          </div>
        ) : (
          <div className="space-y-1">
            {activity.map(entry => (
              <div
                key={entry.id}
                className="flex items-center gap-1.5 px-2 py-1 rounded-[var(--ctl-radius-sm)] border border-transparent transition-[background,border-color] glass-row-hover"
              >
                <span
                  className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: statusColors[entry.status] || 'var(--color-fg-muted)' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] truncate" style={{ color: 'var(--color-text)' }}>
                    {entry.user_name}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {entry.duration_ms !== undefined && (
                    <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary, #999)' }}>
                      {entry.duration_ms < 1000
                        ? `${entry.duration_ms}ms`
                        : `${(entry.duration_ms / 1000).toFixed(1)}s`}
                    </span>
                  )}
                  <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary, #999)' }}>
                    {new Date(entry.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
