import React, { useEffect, useState } from 'react';
import { Text, Box } from 'ink';

/**
 * beepboop — the agenticode / openagentics mascot (Fren.astro), in the terminal.
 *
 * A muted retro-teal desk-robot whose CRT visor IS his face: glow eyes + a
 * sweeping scanline, a burnt-orange antenna that pulses transmit rings when he's
 * broadcasting, amber status-LED cheeks, treads, and his own glyph-gibberish.
 * Mood drives the visor (idle eyes / twin-spinner working / grin happy).
 */

export const BB = {
  hi: '#6FB3A8', // muted retro teal (body)
  lo: '#3C7C72', // deep aged teal (legs / outline / dim scan)
  tip: '#9FD8C4', // phosphor screen ink (eyes / visor)
  glow: '#CFF5E6', // hot phosphor (eye glint / scan crest)
  led: '#DB8240', // BURNT-ORANGE brand signal (antenna LED)
  ledDim: '#8A5226', // faded ring
  ochre: '#D9AE52', // amber status LEDs (cheeks)
} as const;

const GLYPHS = ['◇', '◈', '⊹', '⋄', '✦', '⟁', '⌇', '∿', '⊙', '⌖', '※', '⟡', '▷', '◁', '△', '▽'];
const SPIN = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export type BBMood = 'idle' | 'working' | 'happy' | 'bashful';
type Seg = { t: string; c?: string; bold?: boolean; dim?: boolean };

function gibber(seed: number, min = 2, max = 4): string {
  const n = min + (seed % (max - min + 1));
  let s = '';
  for (let i = 0; i < n; i++) s += GLYPHS[(seed * 7 + i * 13) % GLYPHS.length];
  return s;
}

// body is a 9-wide box; interior rows are exactly 7 cells.
// indices: 0 antenna · 1 stalk · 2 top · 3 eyes · 4 scan · 5 mouth · 6 cheeks · 7 treads
function robot(mood: BBMood, frame: number, broadcast: boolean): Seg[][] {
  // antenna: pulsing transmit rings when broadcasting, else a blinking LED
  let antenna: Seg[];
  if (broadcast) {
    const ph = Math.floor(frame / 3) % 4; // 0..3 expanding
    const cells = Array(9).fill(' ');
    cells[4] = '◉';
    if (ph >= 1) {
      cells[4 - ph] = '(';
      cells[4 + ph] = ')';
    }
    antenna = [
      { t: '   ' },
      ...cells.map((ch, i) =>
        ch === '◉'
          ? { t: ch, c: BB.led, bold: true }
          : ch === ' '
            ? { t: ch }
            : { t: ch, c: ph >= 2 ? BB.ledDim : BB.led },
      ),
    ];
  } else {
    const on = frame % 6 !== 0;
    antenna = [{ t: '       ' }, { t: on ? '◉' : '◌', c: BB.led, bold: on }];
  }

  // eyes (glow)
  const blink = mood === 'idle' && frame % 24 === 9;
  let eL: string, eR: string, ec: string = BB.tip, eb = true;
  if (mood === 'working') {
    const s = SPIN[frame % SPIN.length];
    eL = s; eR = s; ec = BB.led;
  } else if (mood === 'happy') {
    eL = '◠'; eR = '◠'; ec = BB.glow;
  } else if (mood === 'bashful') {
    eL = '◔'; eR = '◔';
  } else {
    eL = blink ? '▬' : '●'; eR = blink ? '▬' : '●'; ec = blink ? BB.tip : BB.glow;
  }
  const eyes: Seg[] = [{ t: '┃ ', c: BB.hi }, { t: `${eL}   ${eR}`, c: ec, bold: eb }, { t: ' ┃', c: BB.hi }];

  // scanline sweep — a bright crest gliding over a dim phosphor row
  const span = 12;
  const raw = frame % span;
  const pos = raw < 7 ? raw : span - raw; // 0..6 bounce
  const scanCells: Seg[] = Array.from({ length: 7 }, (_, i) => {
    const d = Math.abs(i - pos);
    if (d < 1) return { t: '▓', c: BB.glow, bold: true };
    if (d < 2) return { t: '▒', c: BB.tip };
    return { t: '░', c: BB.lo, dim: true };
  });
  const scan: Seg[] = [{ t: '┃', c: BB.hi }, ...scanCells, { t: '┃', c: BB.hi }];

  const m = mood === 'happy' ? ' ◡◡◡◡◡ ' : mood === 'bashful' ? '  ◡‿◡  ' : '  ‿‿‿  ';
  const mouth: Seg[] = [{ t: '┃', c: BB.hi }, { t: m, c: BB.tip }, { t: '┃', c: BB.hi }];
  const cheek: Seg = { t: '◍', c: BB.ochre, bold: mood === 'happy' };

  return [
    antenna,
    [{ t: '       ' }, { t: '╿', c: BB.lo }],
    [{ t: '   ' }, { t: '╭━━━━━━━╮', c: BB.hi }],
    [{ t: '   ' }, ...eyes],
    [{ t: '   ' }, ...scan],
    [{ t: '   ' }, ...mouth],
    [{ t: '   ' }, { t: '╰', c: BB.lo }, cheek, { t: '━━━━━', c: BB.lo }, cheek, { t: '╯', c: BB.lo }],
    [{ t: '     ' }, { t: '▟▙ ▟▙', c: BB.lo }],
  ];
}

const Line: React.FC<{ segs: Seg[] }> = ({ segs }) => (
  <Text>
    {segs.map((s, i) => (
      <Text key={i} color={s.c} bold={s.bold} dimColor={s.dim}>
        {s.t}
      </Text>
    ))}
  </Text>
);

interface BeepboopProps {
  mood?: BBMood;
  says?: string;
  animate?: boolean;
  /** head only (antenna · top · eyes · scan · cheeks) — for the banner */
  compact?: boolean;
  /** pulse transmit rings from the antenna */
  broadcast?: boolean;
}

export const Beepboop: React.FC<BeepboopProps> = ({
  mood = 'idle',
  says,
  animate = true,
  compact = false,
  broadcast = false,
}) => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!animate) return;
    const tick = mood === 'working' || broadcast ? 120 : 240;
    const id = setInterval(() => setFrame((f) => (f + 1) % 600), tick);
    return () => clearInterval(id);
  }, [animate, mood, broadcast]);

  const all = robot(mood, frame, broadcast);
  const lines = compact ? [all[0], all[1], all[2], all[3], all[4], all[6]] : all;

  if (compact) {
    return (
      <Box flexDirection="column">
        {lines.map((segs, i) => (
          <Line key={i} segs={segs} />
        ))}
      </Box>
    );
  }

  const text = says ?? `beep boop ${gibber(frame >> 3)}`;
  const W = text.length;
  return (
    <Box flexDirection="column">
      <Text color={BB.lo}>{`   ╭${'─'.repeat(W + 2)}╮`}</Text>
      <Text>
        <Text color={BB.lo}>{'   │ '}</Text>
        <Text color={BB.tip} italic>
          {text}
        </Text>
        <Text color={BB.lo}>{' │'}</Text>
      </Text>
      <Text color={BB.lo}>{`   ╰──┬${'─'.repeat(Math.max(0, W - 1))}╯`}</Text>
      {lines.map((segs, i) => (
        <Line key={i} segs={segs} />
      ))}
    </Box>
  );
};

export default Beepboop;
