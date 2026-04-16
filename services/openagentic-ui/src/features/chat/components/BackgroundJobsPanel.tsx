/**
 * Background Jobs Panel Component
 * Shows all background processing jobs with their todos, logs, and status
 * Allows users to monitor and cancel long-running background tasks
 */

import React, { useState, useEffect } from 'react';
import { X, Loader2, CheckCircle, Circle, XCircle, ChevronDown, ChevronRight, Trash2, Clock } from '@/shared/icons';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/app/providers/AuthContext';

interface BackgroundJobTodo {
  content: string;
  activeForm: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  error?: string;
}

interface BackgroundJob {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  type: string;
  priority: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  runningFor?: string;
  duration?: string;
  progress?: string;
  error?: string;
  todos?: BackgroundJobTodo[];
  recentLogs?: string[];
  totalLogs?: number;
  hasResult?: boolean;
  result?: string;
}

interface BackgroundJobsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BackgroundJobsPanel: React.FC<BackgroundJobsPanelProps> = ({
  isOpen,
  onClose
}) => {
  const { getAuthHeaders } = useAuth();
  const [jobs, setJobs] = useState<BackgroundJob[]>([]);
  const [expandedJobs, setExpandedJobs] = useState<Set<string>>(new Set());
  const [expandedResults, setExpandedResults] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch all background jobs
  const fetchJobs = async () => {
    setLoading(true);
    setError(null);
    try {
      const authHeaders = getAuthHeaders();
      const response = await fetch('/api/background-jobs', {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch jobs: ${response.statusText}`);
      }

      const data = await response.json();
      setJobs(data.jobs || []);
    } catch (error: any) {
      console.error('Failed to fetch background jobs:', error);
      setError(error.message || 'Failed to fetch jobs');
    } finally {
      setLoading(false);
    }
  };

  // Cancel a background job
  const handleCancelJob = async (jobId: string) => {
    try {
      const response = await fetch(`/api/background-jobs/${jobId}/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to cancel job: ${response.statusText}`);
      }
    } catch (error: any) {
      console.error(`Failed to cancel job ${jobId}:`, error);
      setError(error.message || `Failed to cancel job ${jobId}`);
    }
  };

  // Toggle job expansion
  const toggleJobExpansion = (jobId: string) => {
    setExpandedJobs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(jobId)) {
        newSet.delete(jobId);
      } else {
        newSet.add(jobId);
      }
      return newSet;
    });
  };

  // Toggle result expansion
  const toggleResultExpansion = (jobId: string) => {
    setExpandedResults(prev => {
      const newSet = new Set(prev);
      if (newSet.has(jobId)) {
        newSet.delete(jobId);
      } else {
        newSet.add(jobId);
      }
      return newSet;
    });
  };

  // Fetch full job details including result
  const fetchJobDetails = async (jobId: string) => {
    try {
      const response = await fetch(`/api/background-jobs/${jobId}`, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch job details: ${response.statusText}`);
      }

      const jobDetails = await response.json();

      // Update the job in the list with full details
      setJobs(prev => prev.map(job =>
        job.jobId === jobId ? { ...job, result: jobDetails.result } : job
      ));

      return jobDetails;
    } catch (error: any) {
      console.error(`Failed to fetch job ${jobId} details:`, error);
      setError(error.message || `Failed to fetch job details`);
      return null;
    }
  };

  // Handle result view click
  const handleViewResult = async (jobId: string) => {
    const job = jobs.find(j => j.jobId === jobId);
    if (!job) return;

    // If we don't have the result yet, fetch it
    if (job.hasResult && !job.result) {
      await fetchJobDetails(jobId);
    }

    // Toggle expansion
    toggleResultExpansion(jobId);
  };

  // Fetch jobs initially and set up SSE for real-time updates
  useEffect(() => {
    if (!isOpen) return;

    // Initial fetch
    fetchJobs();

    // Set up SSE for real-time updates
    const authHeaders = getAuthHeaders();
    const authToken = authHeaders?.['Authorization']?.replace('Bearer ', '') || '';
    const sseUrl = authToken
      ? `/api/background-jobs/stream?token=${authToken}`
      : '/api/background-jobs/stream';

    const eventSource = new EventSource(sseUrl, {
      withCredentials: true
    });

    eventSource.addEventListener('update', (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.jobs) {
          setJobs(data.jobs);
        }
      } catch (error) {
        console.error('Failed to parse SSE update:', error);
      }
    });

    eventSource.onerror = (error) => {
      console.error('SSE connection error:', error);
      eventSource.close();
      const pollInterval = setInterval(fetchJobs, 3000);
      return () => clearInterval(pollInterval);
    };

    return () => {
      eventSource.close();
    };
  }, [isOpen]);

  // Listen for autonomous job completion notifications
  useEffect(() => {
    const handleJobCompleted = () => {
      fetchJobs();
    };

    window.addEventListener('background-job-completed', handleJobCompleted);

    return () => {
      window.removeEventListener('background-job-completed', handleJobCompleted);
    };
  }, []);

  // Get status icon with appropriate color
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle size={16} className="text-green-500" />;
      case 'running':
        return <Loader2 size={16} className="text-blue-500 animate-spin" />;
      case 'failed':
        return <XCircle size={16} className="text-red-500" />;
      case 'queued':
        return <Clock size={16} className="text-yellow-500" />;
      default:
        return <Circle size={16} className="text-gray-500" />;
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
            onClick={onClose}
            className="fixed inset-0 bg-black/60 z-40"
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="fixed top-0 right-0 bottom-0 z-50 w-full md:w-[480px] bg-white dark:bg-gray-900 shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="p-4 border-b flex items-center justify-between border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95">
              <div className="flex items-center gap-3">
                <Loader2 size={20} className="text-blue-600 dark:text-blue-400" />
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Background Jobs
                </h2>
                {jobs.length > 0 && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                    {jobs.length}
                  </span>
                )}
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg transition-colors duration-150 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                <X size={20} className="text-gray-600 dark:text-gray-400" />
              </button>
            </div>

            {/* Jobs list */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {/* Error Display */}
              {error && (
                <div className="p-3 rounded-lg border bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/30 text-red-700 dark:text-red-400">
                  <div className="text-sm">{error}</div>
                </div>
              )}

              {loading && jobs.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 size={24} className="animate-spin text-gray-400" />
                </div>
              ) : jobs.length === 0 ? (
                <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                  <p className="text-sm">No background jobs running</p>
                  <p className="text-xs mt-2">Submit work using background_processor MCP</p>
                </div>
              ) : (
                jobs.map(job => {
                  const isExpanded = expandedJobs.has(job.jobId);

                  return (
                    <div
                      key={job.jobId}
                      className="rounded-lg border p-3 bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700"
                    >
                      {/* Job header */}
                      <div className="flex items-start gap-3">
                        <div className="flex-shrink-0 mt-0.5">
                          {getStatusIcon(job.status)}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium truncate text-gray-900 dark:text-white">
                              {job.type.replace('_', ' ').toUpperCase()}
                            </span>
                            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400">
                              P{job.priority}
                            </span>
                          </div>

                          <div className="text-xs text-gray-600 dark:text-gray-400">
                            {job.runningFor && <span>Running for {job.runningFor}</span>}
                            {job.duration && <span>Completed in {job.duration}</span>}
                            {!job.runningFor && !job.duration && <span>Queued</span>}
                          </div>

                          {job.progress && (
                            <div className="text-xs mt-1 text-gray-500">
                              {job.progress}
                            </div>
                          )}

                          {job.error && (
                            <div className="text-xs mt-1 text-red-500">
                              {job.error}
                            </div>
                          )}

                          {/* View Result Button */}
                          {job.status === 'completed' && job.hasResult && (
                            <button
                              onClick={() => handleViewResult(job.jobId)}
                              className="text-xs mt-2 px-2 py-1 rounded transition-colors duration-150 bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-400 hover:bg-blue-200 dark:hover:bg-blue-500/30"
                            >
                              {expandedResults.has(job.jobId) ? 'Hide Result' : 'View Result'}
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-1">
                          {(job.status === 'queued' || job.status === 'running') && (
                            <button
                              onClick={() => handleCancelJob(job.jobId)}
                              className="p-1.5 rounded hover:bg-red-500/10 text-red-600 dark:text-red-400"
                              title="Cancel job"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}

                          {(job.todos && job.todos.length > 0) || (job.recentLogs && job.recentLogs.length > 0) ? (
                            <button
                              onClick={() => toggleJobExpansion(job.jobId)}
                              className="p-1.5 rounded transition-colors duration-150 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400"
                            >
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          ) : null}
                        </div>
                      </div>

                      {/* Expanded content - Todos and Logs */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700/50 space-y-3">
                              {/* Todos */}
                              {job.todos && job.todos.length > 0 && (
                                <div>
                                  <div className="text-xs font-semibold uppercase tracking-wider mb-2 text-gray-600 dark:text-gray-500">
                                    Tasks ({job.todos.length})
                                  </div>
                                  <div className="space-y-1.5">
                                    {job.todos.map((todo, idx) => (
                                      <div key={idx} className="flex items-start gap-2 text-xs">
                                        {todo.status === 'completed' ? (
                                          <CheckCircle size={12} className="mt-0.5 flex-shrink-0 text-green-500" />
                                        ) : todo.status === 'in_progress' ? (
                                          <Loader2 size={12} className="mt-0.5 flex-shrink-0 text-blue-500 animate-spin" />
                                        ) : todo.status === 'failed' ? (
                                          <XCircle size={12} className="mt-0.5 flex-shrink-0 text-red-500" />
                                        ) : (
                                          <Circle size={12} className="mt-0.5 flex-shrink-0 text-gray-500" />
                                        )}
                                        <span className={`${todo.status === 'completed' ? 'line-through text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
                                          {todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Recent logs */}
                              {job.recentLogs && job.recentLogs.length > 0 && (
                                <div>
                                  <div className="text-xs font-semibold uppercase tracking-wider mb-2 flex items-center justify-between text-gray-600 dark:text-gray-500">
                                    <span>Recent Logs</span>
                                    {job.totalLogs && job.totalLogs > job.recentLogs.length && (
                                      <span className="text-gray-500">
                                        (showing last {job.recentLogs.length} of {job.totalLogs})
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-xs font-mono space-y-0.5 p-2 rounded bg-gray-100 dark:bg-gray-900/50">
                                    {job.recentLogs.map((log, idx) => (
                                      <div key={idx} className="text-gray-600 dark:text-gray-400">
                                        {log}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Result Display */}
                      <AnimatePresence>
                        {expandedResults.has(job.jobId) && job.result && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                            className="overflow-hidden"
                          >
                            <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700/50">
                              <div className="text-xs font-semibold uppercase tracking-wider mb-2 text-gray-600 dark:text-gray-500">
                                Result
                              </div>
                              <div className="text-sm p-3 rounded max-h-96 overflow-y-auto bg-gray-100 dark:bg-gray-900/50 text-gray-800 dark:text-gray-300">
                                <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed">
                                  {job.result}
                                </pre>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};

export default BackgroundJobsPanel;
