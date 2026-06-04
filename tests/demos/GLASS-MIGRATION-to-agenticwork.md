# Liquid-Glass / Terminal-Glass migration — openagentic-ui ➜ agenticwork-ui

Goal: bring openagentic's "Terminal Glass" UX (glass surfaces + backdrop blur +
orange aurora atmosphere + the single-driver accent system + dark/light) into the
enterprise `agenticwork-ui`, **while preserving agenticwork's own enterprise
typography** (its self-hosted Inter / JetBrains Mono + its minor-third type scale).
Do **not** import IBM Plex Mono / Instrument Serif.

Source repo: `/home/trent/agenticwork/openagentic/services/openagentic-ui`
Target repo: `/home/trent/agenticwork/agentic/services/agenticwork-ui`

---

## 1. Ease verdict

**Moderate — leaning to the easy end. Budget ~1–1.5 focused days for one engineer.**
This is genuinely low-risk because the two UIs are a *confirmed brand-renamed fork
of one common ancestor*, not two independent codebases. The verification proves it:
both have the identical App-shell mount pattern (`App.tsx` renders
`{backgroundEffect === 'subtle' && <MinimalBackground />}` behind a `relative z-10`
content layer, with the root `<div className="min-h-screen relative overflow-hidden
theme-root">` set to `backgroundColor: transparent` in subtle mode — byte-for-byte
the same in both), the same `ThemeContext.jsx` accent/theme driver, the same
`shared/ui/Glass*` primitives, and the same `.glass` / `.glass-card` /
`.glass-button` / `.glass-surface` / `.glass-modal` class *names* already wired
into the component tree. Roughly 95% of the visual delta lives in **one portable
file** — openagentic's `src/styles/theme.css` (the `--glass-*` token block + the
`.glass*` class bodies + the `.oa-atmosphere/.aurora/.grain/.vignette` block).
Agenticwork is just running a 3-line `backdrop-filter` stub for `.glass` instead of
the full liquid-glass tokens.

What keeps it from being trivial drop-in: **(1) the Tailwind major mismatch** —
openagentic is Tailwind v4 CSS-first (`@import "tailwindcss"` + `@theme` + `@config`
+ `@custom-variant` inside theme.css, consumed via `@tailwindcss/vite`), agenticwork
is still Tailwind v3.4.4 wired through PostCSS with `vite.config.ts` carrying only
`react()`. You **cannot** drop theme.css into v3 as-is; you must back-port the glass
*tokens + classes* as plain CSS into agenticwork's `index.css` (recommended — keeps
v3, zero new deps) **or** adopt the v4 toolchain. **(2) The accent driver diverged**:
openagentic writes a single inline `--user-accent` and resolves `--color-accent →
var(--user-accent, var(--brand-signal))`; agenticwork writes `--user-accent-primary`
and has a flat `--color-accent: #F97316` literal. The accent chain must be
reconciled so the ported glass tints follow the user-picked accent. **(3) Re-touch
breadth + Code Mode preservation** — most surfaces already carry the right class
names so they light up "for free" once the tokens land; a handful need the glass
className re-applied, and `ChatContainer.tsx` is the one heavily-diverged file that
carries enterprise-only Code Mode wiring and must be edited surgically, never
copied. No reimplementation, no new dependencies, no styling-engine change.

---

## 2. What transfers vs what stays

| ADOPT from openagentic (the glass/visual layer) | KEEP in agenticwork (typography / brand contract) |
|---|---|
| **The `--glass-*` token block** from `src/styles/theme.css` (dark block ~lines 289–340, light block ~377–429): `--glass-page-bg`, `--glass-surf-1/2`, `--glass-bg` (the 180° two-wash gradient), `--glass-border`, `--glass-edge`, `--glass-blur` (`blur(28px) saturate(1.4)` dark / `blur(26px) saturate(1.5)` light), `--glass-radius` (18px), `--glass-shadow`, `--glass-card-shadow`. | **The `@font-face` self-hosting block** in `index.css` (lines ~39–66): Inter 400/600/700 + JetBrains Mono from `/artifact-runtime/fonts/*.woff2`. Airgap-safe — do NOT touch, do NOT add Google Fonts. |
| **The `.glass*` class bodies** (theme.css `@layer components`, ~lines 792–1145): `.glass`, `.glass::before` (the hairline top edge), `.glass-card`, `.glass-surface(-subtle/-strong/-hover)`, `.glass-btn*`, `.glass-field*`, `.glass-status*`, `.glass-bubble-user`, `.glass-avatar`, `.glass-kv/-tag/-led/-ok-chip`, `.glass-chip`, `.glass-crumb/-model-pill/-model-dot`, `.glass-tab-active`, `.glass-row-hover/-active`, `.glass-newchat`, `.rise/.rise-d1..6`. | **The `--font-*` family tokens** in `index.css :root` (~lines 218–228): `--font-sans` (Inter/IBM Plex Sans), `--font-mono` (JetBrains Mono Nerd), `--font-terminal`, `--font-code`, `--font-admin`. These stay exactly as-is. |
| **The CRITICAL companion `@layer utilities { .glass { backdrop-filter: var(--glass-blur) } }`** from openagentic `index.css` (~lines 343–347). Without this the frosting is DEAD — utilities outrank components. Port it alongside. | **The full type scale** in `index.css :root` (~lines 205–264): `--text-xs..3xl` (13/14/16/20/24/28/34 minor-third), `--leading-*`, `--font-normal/medium/semibold`, `--tracking-*`. |
| **The aurora atmosphere**: theme.css `.oa-atmosphere/.aurora/.grain/.vignette` block (~lines 1158–1196, includes `@keyframes oa-drift`/`oa-rise`, the inline-SVG grain data-URI, the reduced-motion `@media`) + replace `MinimalBackground.tsx` body with openagentic's aurora markup. | **The `@layer base` typography rules** in `index.css` (~lines 72–188): body 15px/1.55 -0.01em, h1–h6 weights/tracking, `button` `--text-ui-label`, `code/.num` tabular-nums. |
| **The `--aurora-*` tokens** (`--aurora-1..4` as color-mix of `--color-accent`, `--aurora-opacity`, `--aurora-blur`, `--grain-opacity`, `--vignette`) and the on-glass accent tints `--glass-accent-fill/-fill-2/-line/-glow`. | **`MessageBubble.tsx` typographic inline style** (Inter 15px/1.6 -0.005em + fontFeatureSettings kern/liga/calt/tnum/cv11) and the JetBrains-Mono tabular-nums meta row — keep the *fonts*, restyle only the *surface*. |
| **The control chrome tokens** `--ctl-surf/-hover`, `--ctl-primary-grad` (orange send button), `--ctl-primary-glow(-h)`, `--ctl-lift-shadow` (glow-lift hover), `--ctl-focus-ring/-border`, `--ctl-radius(-sm)`, `--ctl-edge`. | **`styles/design-tokens.css`** M3 shape/motion tokens (`--radius-*`, `--surface-*`, `--shadow-soft-*`, `--ease-emphasized/standard`, `--transcript-max-width`) — the composer/buttons/cards consume them. |
| **The single-driver accent chain**: `--color-accent: var(--user-accent, var(--brand-signal))` + the brand ramp `--brand-paper #F4EFE6 / --brand-ink / --brand-terminal-bg #18130C / --brand-signal #FF5722`. | **`ThemeContext.jsx` enterprise accent DEFAULT** (`accentColors[0] = Dark Blue #1E40AF`) — unless the brand explicitly chooses to switch the default to signal-orange. The applyAccentColor/admin-sync *logic* is shared and must keep working. |
| **`src/utils/theme.ts`** `alpha()` / color-mix helper (token-only, drop-in). | **The Code Mode subsystem** (`codemode/`, `features/code/`, `features/code/codeMode.css` `@import`, `bootstrap/`, the `.code-mode[data-cm-theme]` rules, ChatContainer code-mode wiring) — agenticwork-only, openagentic stripped it. Never overwrite. |

**The clean separation that makes this work:** every `.glass*` class references
`var(--font-body)` / `var(--font-mono)` / `var(--font-display)` — never a literal
font name. So agenticwork keeps its enterprise fonts purely by keeping its own
`--font-*` definitions; you just add aliases so the glass classes' font reads
resolve to agenticwork's fonts (see §3, step 4).

---

## 3. The exact prompt to paste

```
You are upgrading the enterprise UI at
/home/trent/agenticwork/agentic/services/agenticwork-ui to openagentic's
"Terminal Glass" liquid-glass UX: glass surfaces + backdrop blur + an orange
aurora atmosphere + a single-driver accent system + dark/light. You MUST preserve
agenticwork's own enterprise typography (its self-hosted Inter / JetBrains Mono and
its minor-third type scale). Do NOT import IBM Plex Mono or Instrument Serif. Do NOT
add Google Fonts. Do NOT touch the @font-face block.

The source of the glass system is the sibling repo:
/home/trent/agenticwork/openagentic/services/openagentic-ui

CONTEXT / LINEAGE (already verified — trust this):
- The two UIs are a brand-renamed fork of one common ancestor. agenticwork-ui App
  shell, ThemeContext, shared/ui Glass* primitives, and the .glass/.glass-card/
  .glass-button/.glass-surface/.glass-modal class NAMES are already wired into the
  component tree. agenticwork is just running a 3-line backdrop-filter STUB for
  .glass (index.css ~line 914) instead of the full liquid-glass tokens.
- agenticwork is Tailwind v3.4.4 via PostCSS; vite.config.ts has only react();
  src/main.tsx imports ONLY ./index.css (through bootstrap/mountApp). openagentic is
  Tailwind v4 CSS-first. You will NOT adopt v4. You will BACK-PORT the glass tokens +
  classes as plain CSS into agenticwork's existing index.css. (No new deps, stays v3.)
- agenticwork/src/app/App.tsx ALREADY mounts
  `{backgroundEffect === 'subtle' && <MinimalBackground />}` behind
  `<div className="relative z-10 min-h-screen">`, with the root div
  `className="min-h-screen relative overflow-hidden theme-root"` and
  `backgroundColor: backgroundEffect === 'subtle' ? 'transparent' : 'var(--color-background)'`.
  This is IDENTICAL to openagentic. The glass host is already in place — you only
  need to fill MinimalBackground's body with the aurora and add the .oa-atmosphere CSS.

DO THIS, IN ORDER. Read each source file before porting it.

STEP 0 — GUARD TEST FIRST (TDD).
- openagentic has src/__tests__/architecture/no-hardcoded-theme-values.source-regression.test.ts
  and src/styles/__tests__/admin-v3-typography-lockdown.test.ts. agenticwork ALSO
  has src/styles/__tests__/admin-v3-typography-lockdown.test.ts and a family of
  src/__tests__/architecture/no-hardcoded-colors-in-*.source-regression.test.ts.
- Before editing CSS, run the agenticwork guard + typography tests and the build to
  capture a GREEN baseline (so you can prove you didn't regress):
    cd /home/trent/agenticwork/agentic/services/agenticwork-ui
    npx vitest run src/styles/__tests__/admin-v3-typography-lockdown.test.ts
    npx vitest run src/__tests__/architecture
    npm run build   # vite build, must be green
- Add a NEW guard test asserting the enterprise fonts are unchanged AND the glass
  tokens are present. Create
  src/__tests__/architecture/glass-migration.source-regression.test.ts that reads
  src/index.css as text and asserts:
    * index.css still contains the exact @font-face url('/artifact-runtime/fonts/inter-regular.woff2')
      and jetbrains-mono-regular.woff2 lines (fonts preserved).
    * --font-sans still resolves to 'Inter' and --font-mono still resolves to
      'JetBrains Mono' (no IBM Plex Mono / Instrument Serif introduced anywhere:
      assert the strings "IBM Plex Mono" and "Instrument Serif" do NOT appear as a
      font-family value in index.css).
    * the ported tokens exist: --glass-bg, --glass-blur, --glass-border, --glass-edge,
      --glass-shadow, --glass-radius, --glass-page-bg, and the aurora tokens
      --aurora-1, --aurora-opacity, --grain-opacity.
    * a single-driver accent chain exists: index.css contains
      "--color-accent: var(--user-accent" (i.e. accent flows from one variable).
  This test should FAIL now (tokens absent) and pass after the port — that's your
  proof-is-green gate.

STEP 1 — PORT THE GLASS TOKENS into agenticwork index.css (plain CSS, v3-safe).
  Source: openagentic src/styles/theme.css.
    * DARK block: lines ~289–340 (--glass-page-bg #140F09, --glass-surf-1/2,
      --glass-bg gradient, --glass-border, --glass-edge, --glass-blur
      blur(28px) saturate(1.4), --glass-radius 18px, --glass-shadow, --glass-card-shadow,
      --glass-accent-fill/-fill-2/-line/-glow, and the --ctl-* control tokens).
    * LIGHT block: lines ~377–429 (the "Warm Frost" re-points: surf 44/58%, bright
      cream --glass-edge, --glass-blur blur(26px) saturate(1.5), softer shadow).
  Target placement in agenticwork src/index.css:
    * Put the DARK glass tokens inside the existing :root { } block (after the
      existing --color-* tokens, ~after line 304 where --color-blur lives).
    * Put the LIGHT glass tokens inside the existing [data-theme="light"] { } block
      (~line 426, where the light --color-* overrides already live), so dark/light
      flips automatically via agenticwork's existing data-theme switch.
  CRITICAL token rewrites while porting (do NOT paste verbatim — re-base onto
  agenticwork's brand vars so it doesn't pull in openagentic's paper/ink literals):
    * Wherever the openagentic glass tokens reference var(--brand-paper) /
      var(--brand-paper-lift) / var(--brand-ink), REPLACE with agenticwork's existing
      surface/ink equivalents so the frost reads on agenticwork's palette. Map:
        var(--brand-paper)      -> #FFFFFF  (the white the glass tints toward)
        var(--brand-paper-lift) -> #FFFFFF
        var(--brand-ink)        -> #000000  (the ink the borders/shadows tint from)
      (These are only the *tint anchors* for color-mix; the actual surface color comes
      from the page background. Using white/black anchors keeps the exact frosted look
      math openagentic uses without dragging in the warm-paper brand. If the brand
      wants the warm look, instead import --brand-paper/--brand-ink as new tokens — but
      default to white/black to stay on agenticwork's macOS palette.)
    * Keep --glass-accent-fill/-fill-2/-line/-glow EXACTLY as color-mix(... var(--color-accent) ...).

STEP 2 — PORT THE .glass* CLASS BODIES into agenticwork index.css.
  Source: openagentic theme.css @layer components, lines ~792–1145:
    .glass (+ .glass::before hairline), .glass-card, .glass-surface(-subtle/-strong/
    -hover), .glass-btn(-primary/-secondary/-ghost/-danger/-mono), .glass-field(-error/
    -label), .glass-status(-success/-error/-warning/-info/-default), .glass-bubble-user,
    .glass-avatar, .glass-kv/-tag/-led/-ok-chip, .glass-chip, .glass-crumb/-model-pill/
    -model-dot, .glass-tab-active, .glass-row-hover/-active, .glass-newchat,
    .rise/.rise-d1..6, plus @keyframes oa-rise + oa-drift.
  Target: REPLACE agenticwork's existing stub bodies and add the missing classes:
    * agenticwork index.css .glass         (~line 914)  -> replace body with openagentic's.
    * agenticwork index.css .glass-card    (~line 1059) -> replace body.
    * agenticwork index.css .glass-button  (~line 1077) -> map onto .glass-btn body
      (keep the .glass-button selector name; just give it the new body).
    * agenticwork index.css .glass-surface (~line 1738) -> replace body.
    * agenticwork index.css .glass-modal   (~line 1756) -> give it the glass-card body.
    * ADD all the new classes agenticwork lacks (.glass-bubble-user, .glass-avatar,
      .glass-kv/-tag/-led/-ok-chip, .glass-chip, .glass-crumb/-model-pill/-model-dot,
      .glass-tab-active, .glass-row-hover/-active, .glass-newchat, .glass-status*,
      .glass-field*, .rise*).
  These bodies are plain CSS + color-mix — they port to v3 with ZERO changes. They are
  defined OUTSIDE @layer here, so no @layer ordering surprise; just make sure they come
  AFTER @tailwind utilities in the cascade (agenticwork puts component CSS after
  @tailwind utilities already — keep them there).
  Do NOT wrap them in @layer components/@apply — leave as plain rules for v3.

STEP 3 — PORT THE CRITICAL backdrop-filter COMPANION RULE.
  Source: openagentic index.css lines ~343–347:
    @layer utilities { .glass { backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur); } }
  Target: agenticwork index.css. agenticwork's .glass stub already sets backdrop-filter,
  so once you replace its body in Step 2 with one that includes
    backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);
  the frosting is alive. You do NOT need a separate @layer utilities rule in v3 because
  there's no competing @layer components .glass here (everything is plain CSS at the same
  layer, source order decides). JUST CONFIRM: the final .glass rule in index.css sets
  BOTH backdrop-filter AND -webkit-backdrop-filter to var(--glass-blur). Verify by grep:
    grep -n 'backdrop-filter: var(--glass-blur)' src/index.css   (must return BOTH lines)

STEP 4 — PRESERVE TYPOGRAPHY: re-point glass font reads to agenticwork's fonts.
  The ported .glass* classes read var(--font-body), var(--font-mono), var(--font-display).
  agenticwork defines --font-sans / --font-mono / --font-terminal but NOT --font-body /
  --font-display. Add THREE alias lines to agenticwork index.css :root (so the glass
  classes resolve to agenticwork's enterprise fonts — NOT IBM Plex):
    --font-body:    var(--font-sans);   /* Inter — enterprise body */
    --font-display: var(--font-sans);   /* enterprise: NO mono display; use Inter */
    /* --font-mono already exists (JetBrains Mono) — leave it */
  DO NOT add IBM Plex Mono or Instrument Serif anywhere. DO NOT change --font-sans,
  --font-mono, --font-terminal, the --text-* scale, --leading-*, --tracking-*, or the
  @font-face block. Leave the @layer base h1-h6/body/button/code rules (index.css ~72-188)
  untouched — they are the enterprise type ramp and must survive.
  NOTE: openagentic uses mono (IBM Plex) for headings/buttons/eyebrows. agenticwork is a
  sans (Inter) brand. By aliasing --font-display -> --font-sans, ported glass buttons/
  pills/crumbs will render in Inter, which is the CORRECT enterprise look. Do not
  "fix" this back to mono.

STEP 5 — RECONCILE THE ACCENT DRIVER (single-driver chain).
  openagentic: --color-accent: var(--user-accent, var(--brand-signal)); ThemeContext
  writes a single inline --user-accent on <html>. agenticwork: flat
  --color-accent: #F97316 (index.css ~line 271) and ThemeContext writes
  --user-accent-primary (NOT --user-accent).
  Make agenticwork's accent flow into the glass tints with MINIMAL churn:
    (a) In agenticwork index.css, change the flat accent literal to a chain:
          --color-accent: var(--user-accent, var(--user-accent-primary, #1E40AF));
        (Keeps the enterprise Dark Blue default if nothing is set; lets a future
        --user-accent override win.)
    (b) In agenticwork src/contexts/ThemeContext.jsx applyAccentColor() (~line 151),
        ADD ONE line next to the existing --user-accent-primary write:
          root.style.setProperty('--user-accent', accent.primary);
        Leave all the existing writes (--user-accent-primary/-secondary/-color/-soft/
        -line + the admin data-accent storage-event sync) intact. This makes every
        --glass-accent-* tint + aurora bloom + .glass-btn-primary follow the
        user-picked accent, exactly like openagentic, with one added line.
    (c) DO NOT change accentColors[0] (keep Dark Blue #1E40AF as enterprise default)
        unless the brand explicitly decides to ship signal-orange. The aurora will be
        a blue aurora by default — that's correct for the enterprise brand. If you DO
        want the openagentic orange, change accentColors[0] to
        { name: 'Orange', primary: '#FF5722', secondary: '#FFB87E' } and reorder.

STEP 6 — PORT THE AURORA ATMOSPHERE.
  (a) CSS: port openagentic theme.css .oa-atmosphere / .oa-atmosphere .aurora /
      .grain / .vignette block (~lines 1158–1196) — including @keyframes oa-drift,
      the inline-SVG fractalNoise grain data-URI, and the prefers-reduced-motion
      @media — into agenticwork index.css (append near the other glass classes).
      The aurora reads --aurora-1..4/--aurora-opacity/--aurora-blur and --glass-page-bg,
      all of which you added in Step 1.
  (b) Component: REPLACE the body of agenticwork
      src/shared/components/MinimalBackground.tsx with openagentic's version:
        export default function MinimalBackground() {
          return (
            <div className="oa-atmosphere" aria-hidden="true">
              <div className="aurora" />
              <div className="grain" />
              <div className="vignette" />
            </div>
          );
        }
      Remove the current static-gradient/inline-style implementation. The App.tsx mount
      (App.tsx ~line 248, already present) and the transparent host (App.tsx ~line 243,
      already present) need NO change — they're identical to openagentic. Keep
      agenticwork's useTheme backgroundEffect 'subtle'/'off' gate (already present;
      ThemeContext ~line 128-132, 342-350) so the animations-off toggle + reduced-motion
      still freeze the drift.

STEP 7 — SHARED/UI PRIMITIVES (low churn, near drop-in).
  Diff and port the openagentic versions of:
    src/shared/ui/GlassContainer.tsx  (variant subtle/medium/strong -> glass-surface*)
    src/shared/ui/GlassCard.tsx       (glass-surface + glass-surface-hover)
  into agenticwork's same paths. These are thin clsx wrappers over the .glass-surface
  classes and hold zero literals. DO NOT touch the two FALSE-FRIEND legacy components —
  they are NOT the Terminal Glass ones and must stay as-is:
    src/shared/components/GlassCard.tsx        (solid, "NO glassmorphism")
    src/components/ui/GlassmorphismContainer.tsx (plain backdrop-blur-md)
  (If a component imports GlassmorphismContainer and you want it frosted, switch the
  import to shared/ui/GlassCard or add the .glass class — but that's optional polish.)

STEP 8 — COMPONENT-BY-COMPONENT GLASS CLASS SWEEP.
  Most surfaces already carry the class names and will light up once tokens land.
  Verify/apply per surface (paths under agenticwork-ui/src):
    [ ] App shell / rail — shared/layouts/MainLayout.tsx: the 64px <aside> uses
        `glass-adaptive`; ensure the main content panel uses `glass`. Nav items can keep
        theme-bg-secondary helpers OR move to glass-row-hover/-active.
    [ ] Sidebar (sessions) — features/chat/components/ChatSidebar.tsx: apply
        `glass rise rise-d1` shell, `glass-btn glass-btn-ghost` icon buttons,
        `glass-field` search, `glass-tab-active` segmented tab, `glass-newchat` button,
        `glass-row-active`/`glass-row-hover` session rows, `eyebrow` section labels.
    [ ] Chat shell — features/chat/components/ChatContainer.tsx: the main chat area
        should be a floating `<div className="glass rise rise-d2 ...">` the aurora blurs
        through. *** THIS FILE IS HEAVILY DIVERGED AND CARRIES ENTERPRISE CODE MODE
        WIRING (useLocation routing, codemode toggle, +~680 lines vs openagentic). DO A
        SURGICAL EDIT — change ONLY the outer panel className/markup to glass. NEVER copy
        openagentic's ChatContainer over it. Preserve all Code Mode wiring,
        useChatStream, deriveFlatMessage, the approval gate. ***
    [ ] Chat header — features/chat/components/ChatHeader.tsx: transparent top bar with
        `borderBottom: 1px solid var(--glass-border)`, `.glass-crumb` breadcrumb,
        `.glass-model-pill`/`.glass-model-dot`.
    [ ] Composer — features/chat/components/ChatInputBar.tsx: wrap in `glass-surface`,
        focus-within `box-shadow: var(--ctl-focus-ring), var(--glass-card-shadow)`; send
        button uses var(--ctl-primary-grad). The current comment says "No glassmorphism" —
        that's the surface to convert. Keep the existing rounded-input/ease-emphasized
        motion tokens (design-tokens.css) — they're compatible.
    [ ] Chat bubbles — features/chat/components/MessageBubble.tsx: user bubble ->
        `glass-bubble-user`; assistant avatar -> `glass-avatar`; result cards ->
        `glass-card`/`glass-kv`/`glass-tag`/`glass-led`/`glass-ok-chip`; suggestion chips
        -> `glass-chip`. *** PRESERVE the existing Inter 15px/1.6 -0.005em inline
        typographic style + fontFeatureSettings + the JetBrains-Mono tabular-nums meta
        row. Change the SURFACE (bg/border/shadow/radius) to glass, NOT the type. *** The
        bubble currently uses inline bg var(--bg-2)/border var(--line-2)/shadow
        var(--mk-shadow-sm) — replace those surface inline styles with the .glass-bubble-user
        class but keep maxWidth var(--transcript-max-width) and the font styling.
    [ ] Cards/panels — shared/ui/Card.tsx, shared/ui/GlassCard.tsx, GlassContainer.tsx:
        ensure they render .glass-surface/.glass-card (done in Step 7).
    [ ] Buttons — shared/ui/Button.tsx: map variants onto glass-btn/glass-btn-primary/
        -secondary/-ghost/-danger (or keep Button's existing classes but ensure the
        primary uses var(--ctl-primary-grad)). Don't break the existing rounded-pill/
        ease-emphasized motion.
    [ ] Inputs — shared/ui/Input.tsx: apply `glass-field` (keep @tailwindcss/forms).
    [ ] Modals — features/settings/components/SettingsModal, features/about/AboutModal:
        use `glass-card` / `glass-modal`.
    [ ] Admin console — features/admin/shell-v3 + admin-*.css + primitives-v3: bring the
        shell onto .glass + the --user-accent accent. The admin has its OWN useTheme hook
        (features/admin/hooks/useTheme.ts) synced via ThemeContext's synthetic storage
        event + the awp-accent localStorage key — your Step 5 (b) change writes
        --user-accent but KEEP the existing data-accent storage-event sync so admin
        repaints. Verify admin dark/light + accent after.
    [ ] Workflows canvas — features/workflows already has its own --wf-glass-* set; leave
        it, OR optionally re-point --wf-glass-bg to var(--glass-bg) for consistency
        (optional, not required).

STEP 9 — VERIFY (proof-is-green; capture evidence).
  cd /home/trent/agenticwork/agentic/services/agenticwork-ui
  (a) Build green:
        npm run build           # vite build must succeed, no PostCSS errors
  (b) Guards green:
        npx vitest run src/styles/__tests__/admin-v3-typography-lockdown.test.ts
        npx vitest run src/__tests__/architecture
        npx vitest run src/__tests__/architecture/glass-migration.source-regression.test.ts  # your new guard
  (c) backdrop-filter wiring present:
        grep -n 'backdrop-filter: var(--glass-blur)' src/index.css   # expect the .glass rule
  (d) No IBM Plex / Instrument Serif leaked:
        grep -nE 'IBM Plex Mono|Instrument Serif' src/index.css      # expect ZERO font-family hits
  (e) @font-face untouched:
        grep -n 'artifact-runtime/fonts/inter-regular.woff2' src/index.css  # still present
  (f) VISUAL CHECK — run dev and eyeball (npm run dev, open the app):
        - DARK mode: frosted glass panels with a drifting orange/accent aurora behind,
          hairline top-edge highlight on .glass, soft layered shadows (not hard shadows).
        - Toggle LIGHT mode: "Warm Frost" — translucent surfaces read on the light page,
          gentler aurora. Both must come from the SAME markup (no separate light JSX).
        - Change accent in settings: aurora bloom + glass tints + primary buttons +
          focus rings all re-tint from the single --user-accent write. Admin console
          re-tints too.
        - Toggle background-animations OFF: aurora freezes (reduced-motion path).
        - CONFIRM TYPOGRAPHY UNCHANGED: body/headings/buttons still render in Inter (NOT
          IBM Plex Mono); code/meta rows still JetBrains Mono; the type scale/tracking is
          the enterprise ramp. If anything renders in a mono display font, you wrongly
          imported openagentic's --font-display = IBM Plex — fix the Step 4 alias.

CONSTRAINTS (do not violate):
- NO new npm dependencies. Stay on Tailwind v3 + PostCSS. Do NOT add @tailwindcss/vite.
- Do NOT create a theme.css in agenticwork; back-port into index.css.
- Do NOT touch the @font-face block, --font-sans/-mono/-terminal, the --text-*/--leading-*/
  --tracking- scale, or @layer base typography.
- Do NOT overwrite or delete the Code Mode subsystem (codemode/, features/code/,
  bootstrap/, .code-mode rules, ChatContainer code-mode wiring).
- Do NOT copy openagentic ChatContainer.tsx, App.tsx, or MessageBubble.tsx wholesale —
  surgical className/markup edits only.
- Every new color/shadow/radius value must read a token (color-mix off --color-accent or a
  --glass-* var), never a raw literal in a component — to satisfy the no-hardcoded guards.

When done, report: build result, guard results, the grep evidence (steps 9c/9d/9e), and a
one-line dark/light/accent visual confirmation.
```

---

## 4. Risks & gotchas

1. **The frosting depends on TWO things, not one.** A `.glass` class alone looks
   flat. It needs (a) the `backdrop-filter: var(--glass-blur)` actually set on the
   final `.glass` rule, AND (b) the `.oa-atmosphere` aurora rendered behind it at
   `z-index:-1` AND (c) the App host transparent. agenticwork already has (b)/(c)
   wired (App.tsx mounts MinimalBackground + sets transparent) — but if you forget to
   give MinimalBackground the real aurora body (Step 6b) you'll get glass panels over
   a flat static gradient and the look will read as "meh, slightly blurred," not
   liquid glass. Verify the aurora is visibly drifting in dark mode.

2. **The `@layer` trap is openagentic-specific — do NOT replicate it in v3.** In
   openagentic the frosting works *because* `index.css`'s `@layer utilities .glass`
   outranks `theme.css`'s `@layer components .glass`. In agenticwork (v3, no competing
   `@layer components .glass`), you must make the single plain `.glass` rule itself set
   `backdrop-filter`. If you naively port openagentic's `@layer components .glass`
   (which has bg/border/shadow but NO backdrop-filter, because the utilities layer
   supplies it there) and forget to merge in the backdrop-filter, you'll port a
   non-frosting glass. **Merge both into one rule.** (Step 2 + Step 3.)

3. **Accent driver name mismatch will silently kill all accent-following tints.**
   openagentic glass tints read `var(--color-accent)` → `var(--user-accent, ...)`.
   agenticwork's ThemeContext writes `--user-accent-primary`, never `--user-accent`,
   and `--color-accent` is a flat `#F97316` literal. If you port the glass tokens but
   skip Step 5, the aurora and glass tints will be locked to `#F97316` orange (or
   `--brand-signal` fallback) and won't follow the user's chosen accent — and worse,
   they'll clash with the enterprise Dark Blue default. The one-line
   `setProperty('--user-accent', accent.primary)` + the `--color-accent` chain rewrite
   is mandatory.

4. **Token SOT double-definition / specificity fights.** agenticwork scatters tokens
   across `index.css :root`, `mockup-v067.css` (`--bg-0..4`, `--accent`, `--mk-shadow-*`),
   `design-tokens.css`, and the admin-*.css layers — all imported into index.css. If you
   re-anchor the ported glass tokens onto `--brand-paper`/`--brand-ink` (which
   agenticwork does NOT define), the color-mix silently produces `transparent`/invalid
   and the glass goes invisible. That's why Step 1 says re-base the tint anchors onto
   `#FFFFFF`/`#000000` (or agenticwork's own surface vars) — never leave a dangling
   `var(--brand-paper)` read. Grep the ported block for `--brand-` after porting; every
   one must either be defined or rewritten.

5. **The Tailwind v3 ↔ v4 seam will break the build if you bring v4 directives.**
   Never paste theme.css's `@import "tailwindcss"`, `@theme {}`, `@config`,
   `@custom-variant`, or `@apply`-on-glass into agenticwork's v3 pipeline — PostCSS/
   Tailwind v3 will error or silently drop them. Port only the *plain CSS* (custom
   properties + class bodies + keyframes). color-mix() and backdrop-filter are plain
   CSS and v3-safe (autoprefixer handles -webkit-). They require Chrome 111+/FF 113+/
   Safari 16.4+ at runtime — fine for an enterprise app, but note it.

6. **ChatContainer is the one landmine file.** agenticwork's ChatContainer is
   ~3199 lines vs openagentic's ~2519, churn +1007/-327, and it carries enterprise-only
   Code Mode wiring (`useLocation`, codemode toggle/routes) plus the streaming engine and
   approval gate. A wholesale copy will delete enterprise features and break the build.
   Edit ONLY the outer glass panel className. If a 3-way merge is unavoidable, preserve
   every Code Mode + approval-gate + useChatStream import.

7. **Admin console has its own theme path.** It uses `features/admin/hooks/useTheme.ts`
   (separate from chat ThemeContext) and reads accent from localStorage `awp-accent` via
   a storage event. Your `--user-accent` write must NOT remove the existing
   `--user-accent-primary` + the admin `data-accent` storage-event dispatch, or the
   admin shell won't repaint on accent change. Test admin dark/light + accent explicitly.

8. **MessageBubble typography regression risk.** The bubble carries an inline Inter
   15px/1.6 -0.005em + `fontFeatureSettings` style and a JetBrains-Mono tabular-nums
   meta row — the enterprise reading experience. When you swap its surface inline styles
   (`background: var(--bg-2)` etc.) for `.glass-bubble-user`, do NOT also drop the
   font/feature-settings inline style or `maxWidth: var(--transcript-max-width)`. Surface
   only.

9. **Light mode is not free — port BOTH `[data-theme]` blocks.** "Warm Frost" light
   intentionally raises surface opacity (44/58%) and brightens the edge/aurora so frost
   reads on a light page. If you only port the dark glass tokens, light mode will show
   near-invisible or muddy glass. Port the light overrides into agenticwork's existing
   `[data-theme="light"]` block.

10. **Guard tests.** agenticwork already runs `admin-v3-typography-lockdown.test.ts`
    and a `no-hardcoded-colors-in-*` family. Any literal color/shadow you bake into a
    *component* (rather than a `--glass-*`/`color-mix(--color-accent)` token) will trip
    them. Keep all new visual values token-driven. The new
    `glass-migration.source-regression.test.ts` (Step 0) is your positive proof the
    fonts survived and the glass landed.
