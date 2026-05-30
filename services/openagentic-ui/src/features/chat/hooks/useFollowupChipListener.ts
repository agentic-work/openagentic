// #921 — followup-chip click → composer submit wiring.
//
// AgenticActivityStream's follow_up render branch dispatches a window-level
// CustomEvent `followup-chip-clicked` carrying `{ detail: { prompt: string } }`.
// This hook listens for that event and forwards the prompt to the supplied
// submit callback. Mounted at ChatContainer level so the composer's existing
// send path stays the single submit code path.
import { useEffect, useRef } from 'react';

export function useFollowupChipListener(onSubmit: (prompt: string) => void) {
  const ref = useRef(onSubmit);
  ref.current = onSubmit;

  useEffect(() => {
    function handler(ev: Event) {
      const detail = (ev as CustomEvent).detail;
      const prompt = detail?.prompt;
      if (typeof prompt !== 'string') return;
      const trimmed = prompt.trim();
      if (!trimmed) return;
      ref.current(trimmed);
    }
    window.addEventListener('followup-chip-clicked', handler);
    return () => window.removeEventListener('followup-chip-clicked', handler);
  }, []);
}
