/**
 * Workflow List Component
 * Dashboard view of all user workflows
 * Theme-aware via CSS variables
 */

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Play,
  Pause,
  Edit,
  Trash2,
  Copy,
  Clock,
  CheckCircle,
  XCircle,
  Search,
  Filter,
  MoreVertical,
  Globe,
  Lock,
  Users,
} from '@/shared/icons';
import { format } from 'date-fns';
import { Workflow, WorkflowStatus } from '../types/workflow.types';

interface WorkflowListProps {
  workflows: Workflow[];
  onCreateNew?: () => void;
  onEdit?: (workflowId: string) => void;
  onExecute?: (workflowId: string) => void;
  onDelete?: (workflowId: string) => void;
  onDuplicate?: (workflowId: string) => void;
  onToggleStatus?: (workflowId: string, status: WorkflowStatus) => void;
  theme?: 'light' | 'dark';
}

export const WorkflowList: React.FC<WorkflowListProps> = ({
  workflows,
  onCreateNew,
  onEdit,
  onExecute,
  onDelete,
  onDuplicate,
  onToggleStatus,
  theme = 'dark',
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<WorkflowStatus | 'all'>('all');
  const [showMenu, setShowMenu] = useState<string | null>(null);

  const filteredWorkflows = workflows.filter((workflow) => {
    const matchesSearch =
      workflow.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      workflow.description?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filterStatus === 'all' || workflow.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  const getStatusColor = (status: WorkflowStatus) => {
    switch (status) {
      case 'active':
        return 'text-success bg-[color-mix(in_srgb,var(--color-success)_20%,transparent)] border-[color-mix(in_srgb,var(--color-success)_30%,transparent)]';
      case 'paused':
        return 'text-warning bg-[color-mix(in_srgb,var(--color-warning)_20%,transparent)] border-[color-mix(in_srgb,var(--color-warning)_30%,transparent)]';
      case 'draft':
        return 'text-text-muted bg-[color-mix(in_srgb,var(--color-fg-subtle)_20%,transparent)] border-[color-mix(in_srgb,var(--color-fg-subtle)_30%,transparent)]';
      case 'archived':
        return 'text-text-muted bg-[color-mix(in_srgb,var(--color-fg-subtle)_20%,transparent)] border-border/30';
      default:
        return 'text-text-muted bg-[color-mix(in_srgb,var(--color-fg-subtle)_20%,transparent)] border-[color-mix(in_srgb,var(--color-fg-subtle)_30%,transparent)]';
    }
  };

  const getStatusIcon = (status: WorkflowStatus) => {
    switch (status) {
      case 'active':
        return <CheckCircle className="w-3.5 h-3.5" />;
      case 'paused':
        return <Pause className="w-3.5 h-3.5" />;
      default:
        return <Clock className="w-3.5 h-3.5" />;
    }
  };

  return (
    <div
      className="w-full h-full flex flex-col"
      style={{ backgroundColor: 'var(--color-bg)' }}
    >
      {/* Header */}
      <div
        className="glass-surface p-6 border-b"
        style={{
          borderRadius: 0,
          borderColor: 'var(--glass-border)',
        }}
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
              Workflows
            </h1>
            <p className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
              Automate tasks with custom workflows
            </p>
          </div>

          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={onCreateNew}
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium bg-gradient-to-r from-accent-primary to-accent-secondary text-text hover:opacity-90 shadow-lg"
          >
            <Plus className="w-5 h-5" />
            Create Workflow
          </motion.button>
        </div>

        {/* Search and Filter */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4" style={{ color: 'var(--color-text-tertiary)' }} />
            <input
              type="text"
              placeholder="Search workflows..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="glass-field w-full pl-10 pr-4 py-2 rounded-lg text-sm"
            />
          </div>

          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as WorkflowStatus | 'all')}
            className="glass-field px-4 py-2 rounded-lg text-sm font-medium"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      </div>

      {/* Workflow Grid */}
      <div className="flex-1 overflow-y-auto p-6">
        {filteredWorkflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full" style={{ color: 'var(--color-text-tertiary)' }}>
            <Search className="w-16 h-16 mb-4 opacity-20" />
            <p className="text-lg font-medium">No workflows found</p>
            <p className="text-sm">Create your first workflow to get started</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AnimatePresence>
              {filteredWorkflows.map((workflow) => (
                <motion.div
                  key={workflow.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="glass-card glass-surface-hover p-5 cursor-pointer"
                  onClick={() => onEdit?.(workflow.id)}
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-base font-semibold truncate" style={{ color: 'var(--color-text)' }}>
                        {workflow.name}
                      </h3>
                      {workflow.description && (
                        <p className="text-sm mt-1 line-clamp-2" style={{ color: 'var(--color-text-tertiary)' }}>
                          {workflow.description}
                        </p>
                      )}
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMenu(showMenu === workflow.id ? null : workflow.id);
                      }}
                      className="p-1 rounded transition-colors hover:opacity-80"
                      style={{ color: 'var(--color-text-tertiary)' }}
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    {/* Dropdown Menu */}
                    {showMenu === workflow.id && (
                      <div
                        className="glass absolute right-0 mt-8 w-48 z-10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          onClick={() => {
                            onExecute?.(workflow.id);
                            setShowMenu(null);
                          }}
                          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left hover:opacity-80"
                          style={{ color: 'var(--color-text)' }}
                        >
                          <Play className="w-4 h-4" />
                          Execute
                        </button>
                        <button
                          onClick={() => {
                            onDuplicate?.(workflow.id);
                            setShowMenu(null);
                          }}
                          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left hover:opacity-80"
                          style={{ color: 'var(--color-text)' }}
                        >
                          <Copy className="w-4 h-4" />
                          Duplicate
                        </button>
                        <button
                          onClick={() => {
                            onDelete?.(workflow.id);
                            setShowMenu(null);
                          }}
                          className="w-full flex items-center gap-2 px-4 py-2 text-sm text-left hover:opacity-80 text-error"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Status & Metadata */}
                  <div className="flex items-center gap-2 mb-3">
                    <span
                      className={`
                        inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium
                        ${getStatusColor(workflow.status)}
                      `}
                    >
                      {getStatusIcon(workflow.status)}
                      {workflow.status.charAt(0).toUpperCase() + workflow.status.slice(1)}
                    </span>

                    {/* Visibility indicator */}
                    {workflow.is_public ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[color-mix(in_srgb,var(--color-success)_10%,transparent)] text-success border border-[color-mix(in_srgb,var(--color-success)_20%,transparent)]">
                        <Globe className="w-3 h-3" />
                        Public
                      </span>
                    ) : (workflow as any).group_id ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[color-mix(in_srgb,var(--color-info)_10%,transparent)] text-info border border-[color-mix(in_srgb,var(--color-info)_20%,transparent)]">
                        <Users className="w-3 h-3" />
                        Team
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ color: 'var(--color-fg-subtle)', background: 'var(--ctl-surf)', border: '1px solid var(--glass-border)' }}>
                        <Lock className="w-3 h-3" />
                        Private
                      </span>
                    )}

                    {workflow.tags && workflow.tags.length > 0 && (
                      <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                        {workflow.tags[0]}
                        {workflow.tags.length > 1 && ` +${workflow.tags.length - 1}`}
                      </span>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                    <div>
                      <span className="font-medium">{Array.isArray(workflow.nodes) ? workflow.nodes.length : 0}</span> nodes
                    </div>
                    {workflow.executionCount !== undefined && (
                      <div>
                        <span className="font-medium">{workflow.executionCount}</span> runs
                      </div>
                    )}
                    {workflow.lastExecutedAt && (
                      <div>
                        Last run: {format(new Date(workflow.lastExecutedAt), 'MMM d')}
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};
