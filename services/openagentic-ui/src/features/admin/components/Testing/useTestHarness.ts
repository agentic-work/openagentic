/**
 * useTestHarness — SSE hook for the admin test harness.
 * Consumes POST /api/admin/test-harness/run and manages test state.
 */
import { useState, useRef, useCallback } from 'react';
import { apiEndpoint } from '@/utils/api';
import { parseNDJSONStream } from '@/utils/ndjsonStream';

export interface TestResult {
  category: string;
  test: string;
  status: 'pass' | 'fail' | 'skip' | 'running';
  durationMs?: number;
  details?: any;
  error?: string;
  timestamp: string;
}

export interface LogEntry {
  time: string;
  status: 'pass' | 'fail' | 'skip' | 'running' | 'info';
  message: string;
}

interface Summary {
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  totalTimeMs: number;
}

export function useTestHarness() {
  const [results, setResults] = useState<TestResult[]>([]);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const addLog = useCallback((status: LogEntry['status'], message: string) => {
    const time = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
    setLogEntries(prev => [...prev.slice(-199), { time, status, message }]);
  }, []);

  const startTests = useCallback(async (categories: string[]) => {
    // Reset state
    setResults([]);
    setLogEntries([]);
    setSummary(null);
    setRunning(true);

    abortRef.current = new AbortController();

    try {
      addLog('info', `Starting tests: ${categories.join(', ')}`);

      const token = localStorage.getItem('auth_token') || document.cookie.match(/auth_token=([^;]+)/)?.[1] || '';

      const response = await fetch(apiEndpoint('/admin/test-harness/run'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/x-ndjson',
          'Cache-Control': 'no-cache',
        },
        body: JSON.stringify({ categories }),
        signal: abortRef.current.signal,
        cache: 'no-store',
      });

      if (!response.ok) {
        addLog('fail', `HTTP ${response.status}: ${response.statusText}`);
        setRunning(false);
        return;
      }

      // v0.6.7: NDJSON stream via shared parser.
      for await (const payload of parseNDJSONStream<{ type: string; [k: string]: unknown }>(response)) {
        if (payload.type === 'test_result') {
          const result = payload as unknown as TestResult;
          setResults(prev => [...prev, result]);
          const icon = result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : result.status === 'skip' ? '⚠️' : '⏳';
          const duration = result.durationMs != null ? ` ${result.durationMs}ms` : '';
          const ttft = (result.details as { ttft?: number })?.ttft != null ? ` TTFT: ${(result.details as { ttft: number }).ttft}ms` : '';
          addLog(result.status, `${icon} ${result.test}${duration}${ttft}`);
        } else if (payload.type === 'progress') {
          addLog('info', String(payload.message ?? ''));
        } else if (payload.type === 'complete') {
          setSummary(payload as unknown as Summary);
          addLog('info', `✨ Complete: ${payload.passed} passed, ${payload.failed} failed, ${payload.skipped} skipped in ${payload.totalTimeMs}ms`);
        } else if (payload.type === 'error') {
          addLog('fail', `Error: ${payload.message ?? payload.error ?? 'unknown'}`);
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        addLog('fail', `Stream error: ${err.message}`);
      }
    } finally {
      setRunning(false);
    }
  }, [addLog]);

  const stopTests = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
    addLog('info', 'Tests stopped');
  }, [addLog]);

  const clearResults = useCallback(() => {
    setResults([]);
    setLogEntries([]);
    setSummary(null);
  }, []);

  return { results, logEntries, running, summary, startTests, stopTests, clearResults };
}
