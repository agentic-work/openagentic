/**
 * useTestHarness — SSE hook for the admin test harness.
 * Consumes POST /api/admin/test-harness/run and manages test state.
 */
import { useState, useRef, useCallback } from 'react';
import { apiEndpoint } from '@/utils/api';

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

      const token = localStorage.getItem('awc_token') || document.cookie.match(/awc_token=([^;]+)/)?.[1] || '';

      const response = await fetch(apiEndpoint('/admin/test-harness/run'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Accept': 'text/event-stream',
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

      const reader = response.body?.getReader();
      if (!reader) {
        addLog('fail', 'No response body');
        setRunning(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const eventStrings = buffer.split('\n\n');
        buffer = eventStrings.pop() || '';

        for (const eventString of eventStrings) {
          if (!eventString.trim()) continue;

          const lines = eventString.split('\n');
          let eventType: string | null = null;
          let eventData = '';

          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim();
            else if (line.startsWith('data: ')) eventData += line.slice(6);
          }

          if (!eventData) continue;

          try {
            const payload = JSON.parse(eventData);

            if (eventType === 'test_result') {
              const result = payload as TestResult;
              setResults(prev => [...prev, result]);

              const icon = result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : result.status === 'skip' ? '⚠️' : '⏳';
              const duration = result.durationMs != null ? ` ${result.durationMs}ms` : '';
              const ttft = result.details?.ttft != null ? ` TTFT: ${result.details.ttft}ms` : '';
              addLog(result.status, `${icon} ${result.test}${duration}${ttft}`);
            } else if (eventType === 'progress') {
              addLog('info', payload.message);
            } else if (eventType === 'complete') {
              setSummary(payload as Summary);
              addLog('info', `✨ Complete: ${payload.passed} passed, ${payload.failed} failed, ${payload.skipped} skipped in ${payload.totalTimeMs}ms`);
            } else if (eventType === 'error') {
              addLog('fail', `Error: ${payload.error}`);
            }
          } catch {
            // Skip unparseable events
          }
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
