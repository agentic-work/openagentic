import React from 'react';
import { Text, Box } from 'ink';
import { Grad, Rule, Bar } from './effects.tsx';
import { Footer } from './Footer.tsx';

// openagentics.io palette — matched 1:1 to the site's CSS custom props
// (Base.astro --signal/--accent/--ink/--muted, Fren.astro --bb-* LEDs).
// Boards-of-Canada warm retro: moss greens + phosphor teal, amber LED signal,
// terminal cream text. The site's PRIMARY accent is moss --signal #5FA877 /
// --signal-ink #88CCA0; the amber --bb-led #DB8240 is reserved for the LED /
// active markers (Fren's eye, cursor, the brand ⌥ glow), exactly as the site.
export const COLORS = {
  // primary accent = the site's moss --signal / --signal-ink family
  accent: '#88CCA0', //  --signal-ink / --accent-ink (heading accent on dark)
  accentDeep: '#5FA877', //  --signal / --accent (primary accent)
  ink: '#F3F1EC', //  site terminal cream (#f3f1ec — .t-cmd / .ht-pre / .run-cmd-pre)
  muted: '#7E927E', //  --muted (dusty tan)
  faint: '#56654F', //  --muted-2 (deeper dusty tan)
  ok: '#88CCA0', //  --signal-ink (success moss)
  warn: '#D9AE52', //  --bb-ochre (amber status LED)
  err: '#E0663A', //  --bb-alert (hot burnt-orange alert)
  signal: '#DB8240', //  --bb-led (BURNT-ORANGE brand LED signal — active markers)
  teal: '#9FD8C4', //  --bb-tip (phosphor screen ink)
  espresso: '#1F0D04', //  site espresso (::selection / on-accent ink)
  burntOrange: '#B83A0E', //  site burnt orange (--signal-ink focus / emphasis)
} as const;

// the brand sweep, matched to the site wordmark gradient direction
// (.hero-word: --ink → --signal-ink → --signal, a cream→moss lit-phosphor fill)
// widened across the Fren --bb-* palette so the per-char gradient reads as the
// full brand chord: teal-hi → phosphor-tip → moss(--signal-ink/--accent) →
// ochre → led-amber.  (--bb-hi → --bb-tip → #88CCA0 → --bb-ochre → --bb-led)
const STOPS = ['#6FB3A8', '#9FD8C4', '#88CCA0', '#D9AE52', '#DB8240'];

// the brand ⌥ glyph fill — mirrors the site's .hero-oglyph lit-phosphor moss
// gradient (linear-gradient: --ink cream → --signal-ink → --signal moss), so
// the glyph reads as the glowing moss ⌥ from the site header / hero.
const GLYPH_STOPS = ['#F3F1EC', '#88CCA0', '#5FA877'];

const width = () => Math.max(44, Math.min((process.stdout.columns || 80) - 6, 88));

export const Banner: React.FC = () => {
  const w = width();
  return (
    <Box flexDirection="column" paddingY={1}>
      <Box width={w} justifyContent="space-between">
        <Box>
          {/* brand ⌥ — the site's lit-phosphor moss glyph (.hero-oglyph /
              masthead .brand-glyph): a cream→moss gradient fill, bold + mono.
              An amber --bb-led "·" rides beside it as the active LED marker. */}
          <Grad text="⌥" stops={GLYPH_STOPS} bold />
          <Text color={COLORS.signal} bold>
            {' '}·{' '}
          </Text>
          <Grad text="openagentic" stops={STOPS} bold />
        </Box>
        <Text color={COLORS.faint}>self-hosted · docker / k8s · v1.0</Text>
      </Box>
      <Rule width={w} stops={STOPS} />
      <Text color={COLORS.muted}>the open agentic platform for IT operations</Text>
    </Box>
  );
};

export const StepHeader: React.FC<{ step: number; total: number; title: string }> = ({ step, total, title }) => (
  <Box flexDirection="column" marginBottom={1}>
    <Box>
      <Text color={COLORS.accent} bold>
        {String(step).padStart(2, '0')}
      </Text>
      <Text color={COLORS.faint}> / {String(total).padStart(2, '0')}</Text>
      <Text color={COLORS.faint}>{'   '}</Text>
      <Text color={COLORS.ink} bold>
        {title}
      </Text>
    </Box>
    <Box marginTop={0}>
      <Bar value={step} total={total} width={Math.min(36, width())} stops={STOPS} />
    </Box>
  </Box>
);

export const Hint: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text color={COLORS.muted}>{children}</Text>
);

interface ScreenProps {
  step: number;
  total: number;
  title: string;
  children: React.ReactNode;
}

export const Screen: React.FC<ScreenProps> = ({ step, total, title, children }) => (
  <Box flexDirection="column" paddingX={2}>
    <Banner />
    <StepHeader step={step} total={total} title={title} />
    {children}
    {/* Doc looked up from the existing `title` prop — steps pass nothing new. */}
    <Footer title={title} />
  </Box>
);
