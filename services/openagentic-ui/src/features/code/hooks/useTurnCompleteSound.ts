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

import { useEffect, useRef } from 'react';

const STORAGE_KEY = 'codemode:sounds';

function soundsEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export function setSoundsEnabled(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    /* quota */
  }
}

export function getSoundsEnabled(): boolean {
  return soundsEnabled();
}

/**
 * Fires the ding whenever `isStreaming` transitions from `true` to
 * `false`. Skips the very first transition at mount (so an already-
 * finished session doesn't chime on load).
 */
export function useTurnCompleteSound(isStreaming: boolean) {
  const prevRef = useRef<boolean | null>(null);
  const contextRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = isStreaming;

    // Ignore initial undefined→? transition.
    if (prev === null) return;

    // Fire only on true → false (turn just completed).
    if (!(prev === true && isStreaming === false)) return;
    if (!soundsEnabled()) return;

    try {
      // Lazy create the AudioContext on first fire — browsers require
      // a user gesture to create one, and the user initiated the turn.
      if (!contextRef.current) {
        const Ctx =
          (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return;
        contextRef.current = new Ctx();
      }
      const ctx = contextRef.current!;

      // Two-tone ding: a short upper pitch then a brief lower one.
      const now = ctx.currentTime;
      const makeBeep = (freq: number, start: number, duration: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.value = 0;
        gain.gain.setValueAtTime(0, now + start);
        gain.gain.linearRampToValueAtTime(0.08, now + start + 0.008);
        gain.gain.linearRampToValueAtTime(0, now + start + duration);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + start);
        osc.stop(now + start + duration + 0.02);
      };
      makeBeep(880, 0, 0.12); // A5
      makeBeep(1318.51, 0.09, 0.15); // E6
    } catch {
      /* audio failed — degrade silently */
    }
  }, [isStreaming]);
}
