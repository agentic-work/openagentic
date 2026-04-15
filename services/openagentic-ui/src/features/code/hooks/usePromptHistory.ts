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

import { useCallback, useEffect, useRef, useState } from 'react';

const KEY_PREFIX = 'codemode:promptHistory:';
const MAX_HISTORY = 200;

function readStored(sessionId: string | null): string[] {
  if (!sessionId || typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY_PREFIX + sessionId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function writeStored(sessionId: string | null, history: string[]): void {
  if (!sessionId || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY_PREFIX + sessionId, JSON.stringify(history));
  } catch {
    /* quota / disabled */
  }
}

export interface UsePromptHistoryReturn {
  /** Push a submitted prompt onto the stack. Called by CodeModeChatView on send. */
  push: (text: string) => void;
  /**
   * Start stepping backward through history (Up key). If `draft` is
   * provided and we're not currently browsing, it's saved so Down can
   * restore it. Returns the text to display, or null if no history.
   */
  stepBack: (draft: string) => string | null;
  /**
   * Step forward toward the draft (Down key). Returns the text to
   * display, or the saved draft if we walked past the newest entry,
   * or null if we're already at the draft.
   */
  stepForward: () => string | null;
  /** True if the user is currently browsing history (not at draft). */
  isBrowsing: boolean;
  /** Drop out of history browsing (called on any user edit). */
  resetBrowse: () => void;
}

export function usePromptHistory(sessionId: string | null): UsePromptHistoryReturn {
  const historyRef = useRef<string[]>([]);
  const cursorRef = useRef<number>(-1); // -1 = at draft, 0..len-1 = history index
  const draftRef = useRef<string>('');
  const [isBrowsing, setIsBrowsing] = useState(false);

  // Load from storage when sessionId changes.
  useEffect(() => {
    historyRef.current = readStored(sessionId);
    cursorRef.current = -1;
    draftRef.current = '';
    setIsBrowsing(false);
  }, [sessionId]);

  const push = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      const h = historyRef.current;
      // Dedupe against the most recent entry to avoid double-submit noise.
      if (h.length > 0 && h[h.length - 1] === trimmed) {
        cursorRef.current = -1;
        setIsBrowsing(false);
        return;
      }
      h.push(trimmed);
      if (h.length > MAX_HISTORY) h.shift();
      cursorRef.current = -1;
      draftRef.current = '';
      setIsBrowsing(false);
      writeStored(sessionId, h);
    },
    [sessionId],
  );

  const stepBack = useCallback((draft: string): string | null => {
    const h = historyRef.current;
    if (h.length === 0) return null;
    if (cursorRef.current === -1) {
      draftRef.current = draft;
      cursorRef.current = h.length - 1;
      setIsBrowsing(true);
      return h[cursorRef.current];
    }
    if (cursorRef.current > 0) {
      cursorRef.current--;
      return h[cursorRef.current];
    }
    // Already at oldest — clamp.
    return h[0];
  }, []);

  const stepForward = useCallback((): string | null => {
    const h = historyRef.current;
    if (cursorRef.current === -1) return null; // nothing to do
    if (cursorRef.current < h.length - 1) {
      cursorRef.current++;
      return h[cursorRef.current];
    }
    // Past newest — return to draft.
    cursorRef.current = -1;
    setIsBrowsing(false);
    return draftRef.current;
  }, []);

  const resetBrowse = useCallback(() => {
    if (cursorRef.current !== -1) {
      cursorRef.current = -1;
      draftRef.current = '';
      setIsBrowsing(false);
    }
  }, []);

  return { push, stepBack, stepForward, isBrowsing, resetBrowse };
}
