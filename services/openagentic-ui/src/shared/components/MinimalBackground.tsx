/**
 * MinimalBackground — the living "Terminal Glass" atmosphere.
 *
 * A fixed, behind-everything atmosphere layer that the frosted-glass surfaces
 * blur to get real depth: a slowly-drifting signal-orange AURORA + a fine GRAIN
 * overlay + a soft VIGNETTE, over the deep page base. The whole look flows from
 * the ONE SOT (theme.css): every value reads a per-theme glass / aurora CSS
 * token, so dark ("orange-aurora") and light ("Warm Frost") both come from the
 * same markup — gentler in light, hero in dark. See
 * docs/design/terminal-glass-reference.html.
 *
 * Mounted by the App shell only when backgroundEffect === 'subtle' (the user's
 * background-animations toggle); when 'off' the App paints a solid --color-bg
 * instead. prefers-reduced-motion freezes the drift (handled in theme.css).
 *
 * This component holds NO color/font literals — all visual values live in
 * theme.css. It composes the .oa-atmosphere / .aurora / .grain / .vignette
 * classes defined there.
 */

import React from 'react';

export default function MinimalBackground() {
  return (
    <div className="oa-atmosphere" aria-hidden="true">
      <div className="aurora" />
      <div className="grain" />
      <div className="vignette" />
    </div>
  );
}
