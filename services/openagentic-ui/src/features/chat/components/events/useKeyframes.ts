/**
 * Phase G (task #152) — scoped keyframe injection.
 *
 * The event-renderer components use a handful of CSS keyframe animations
 * (pulse dots on the stage strip, spinning icons on status lines). We
 * inject them once via a singleton style tag rather than touching
 * `tailwind.config.js` / global CSS — task #160 owns that surface.
 *
 * The export is a no-op in SSR / jest without `document`; components
 * should call it in a render path, not inside useEffect.
 */

const STYLE_ID = 'phase-g-event-keyframes';

const KEYFRAMES = `
@keyframes stageStripPulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 3px rgba(139,92,246,0.22); }
  50%      { opacity: 0.7; box-shadow: 0 0 0 5px rgba(139,92,246,0.15); }
}
@keyframes ragSpin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
`;

let injected = false;

export function ensurePhaseGKeyframes(): void {
  if (injected) return;
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) {
    injected = true;
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = KEYFRAMES;
  document.head.appendChild(style);
  injected = true;
}
