/**
 * useCodeModeFirstRun — hook for tracking / marking the Code Mode first-run
 * state in the user's server-side settings.
 *
 * Returns:
 *   firstRunComplete  — boolean or null while loading
 *   loading           — true while the GET is in-flight
 *   markComplete      — async fn; PATCHes firstRunComplete:true and updates
 *                        local state
 *
 * PATCH shape (matches /api/user/settings route body schema):
 *   { settings: { codeMode: { firstRunComplete: true } } }
 */
import { useEffect, useState, useCallback } from 'react';
import { apiRequest } from '@/utils/api';

interface UseCodeModeFirstRunResult {
  firstRunComplete: boolean | null;
  loading: boolean;
  markComplete: (opts?: { model?: string }) => Promise<void>;
}

export function useCodeModeFirstRun(): UseCodeModeFirstRunResult {
  const [firstRunComplete, setFirstRunComplete] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const res = await apiRequest('/api/user/settings');
        if (cancelled) return;

        if (!res.ok) {
          console.warn('[useCodeModeFirstRun] Failed to fetch settings:', res.status);
          setFirstRunComplete(false);
          return;
        }

        const data = await res.json();
        const value = data?.settings?.codeMode?.firstRunComplete ?? false;
        setFirstRunComplete(Boolean(value));
      } catch (e) {
        if (!cancelled) {
          console.warn('[useCodeModeFirstRun] Error fetching settings:', e);
          setFirstRunComplete(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => { cancelled = true; };
  }, []);

  const markComplete = useCallback(async (_opts?: { model?: string }) => {
    try {
      const res = await apiRequest('/api/user/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          settings: { codeMode: { firstRunComplete: true } },
        }),
      });

      if (!res.ok) {
        console.warn('[useCodeModeFirstRun] Failed to PATCH settings:', res.status);
        return;
      }

      setFirstRunComplete(true);
    } catch (e) {
      console.warn('[useCodeModeFirstRun] Error marking complete:', e);
    }
  }, []);

  return { firstRunComplete, loading, markComplete };
}
