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
 * useTTFT — measures time-to-first-token for chat and terminal interactions.
 *
 * Chat/Agent: Records timestamp on message send, captures first content_block_delta.
 * Terminal: Records timestamp on WebSocket write, captures first response bytes.
 *
 * Returns current TTFT in ms and a color category for display.
 */

import { useState, useCallback, useRef } from 'react';

export interface TTFTMeasurement {
  ttftMs: number | null;
  category: 'fast' | 'medium' | 'slow' | null;
  color: string;
}

export function useTTFT() {
  const [ttftMs, setTtftMs] = useState<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  const startMeasurement = useCallback(() => {
    startTimeRef.current = performance.now();
    setTtftMs(null);
  }, []);

  const recordFirstToken = useCallback(() => {
    if (startTimeRef.current === null) return;
    const elapsed = Math.round(performance.now() - startTimeRef.current);
    setTtftMs(elapsed);
    startTimeRef.current = null;
  }, []);

  const reset = useCallback(() => {
    startTimeRef.current = null;
    setTtftMs(null);
  }, []);

  let category: 'fast' | 'medium' | 'slow' | null = null;
  let color = '#8b949e'; // default gray
  if (ttftMs !== null) {
    if (ttftMs < 2000) {
      category = 'fast';
      color = '#22C55E'; // green
    } else if (ttftMs < 5000) {
      category = 'medium';
      color = '#d29922'; // yellow
    } else {
      category = 'slow';
      color = '#f85149'; // red
    }
  }

  return {
    ttftMs,
    category,
    color,
    startMeasurement,
    recordFirstToken,
    reset,
  };
}
