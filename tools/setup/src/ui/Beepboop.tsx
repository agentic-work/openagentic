import React, { useEffect, useState } from 'react';
import { Text, Box } from 'ink';

/**
 * beepboop — the agenticode / openagentics mascot, ported to the terminal.
 *
 * The web Fren.astro is a muted retro-teal desk-robot whose CRT visor IS his
 * face (eyes when idle, a spinner when he's working, a grin when he's done). He
 * blinks a burnt-orange antenna LED, has amber status-LED cheeks + treads, and
 * speaks in his own glyph-gibberish — never real words. Same fella, rendered in
 * box-drawing + his exact palette so he lives in the install wizard.
 */

// his palette, lifted straight from Fren.astro
export const BB = {
  hi: '#6FB3A8', // muted retro teal (body)
  lo: '#3C7C72', // deep aged teal (legs / outline)
  tip: '#9FD8C4', // phosphor screen ink (eyes / visor)
  led: '#DB8240', // BURNT-ORANGE brand signal (antenna LED)
  ochre: '#D9AE52', // amber status LEDs (cheeks)
} as const;

// his fake script — a short "word" of these, never real language
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

// body is a 9-wide box (╭ + 7 + ╮); every interior row is exactly 7 cells.
function robot(mood: BBMood, frame: number): Seg[][] {
  const ledOn = frame % 6 !== 0;
  const led: Seg = { t: ledOn ? '◉' : '◌', c: BB.led, bold: ledOn };
  const blink = mood === 'idle' && frame % 22 === 7;

  // visor face — each eye is ONE cell; interior pattern ` X   X ` = 7 cells
  let eL: string, eR: string, ec: string = BB.tip, eb = false;
  if (mood === 'working') {
    const s = SPIN[frame % SPIN.length];
    eL = s; eR = s; ec = BB.led; eb = true;
  } else if (mood === 'happy') {
    eL = '◠'; eR = '◠'; eb = true;
  } else if (mood === 'bashful') {
    eL = '◔'; eR = '◔';
  } else {
    eL = blink ? '▬' : '●'; eR = blink ? '▬' : '●';
  }
  const face: Seg[] = [{ t: '┃ ', c: BB.hi }, { t: `${eL}   ${eR}`, c: ec, bold: eb }, { t: ' ┃', c: BB.hi }];

  const m = mood === 'happy' ? ' ◡◡◡◡◡ ' : mood === 'bashful' ? '  ◡‿◡  ' : '  ‿‿‿  ';
  const mouth: Seg[] = [{ t: '┃', c: BB.hi }, { t: m, c: BB.tip }, { t: '┃', c: BB.hi }];
  const cheek: Seg = { t: '◍', c: BB.ochre, bold: mood === 'happy' };

  return [
    [{ t: '       ' }, led],
    [{ t: '       ' }, { t: '╿', c: BB.lo }],
    [{ t: '   ' }, { t: '╭━━━━━━━╮', c: BB.hi }],
    [{ t: '   ' }, ...face],
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
  /** real words for his bubble; omit and he speaks glyph-gibberish */
  says?: string;
  animate?: boolean;
  /** head only (no bubble, no legs) — for the banner */
  compact?: boolean;
}

export const Beepboop: React.FC<BeepboopProps> = ({ mood = 'idle', says, animate = true, compact = false }) => {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!animate) return;
    // smooth while he's working (spinner); a calm blink otherwise so the
    // banner doesn't churn the screen during text entry.
    const tick = mood === 'working' ? 110 : 430;
    const id = setInterval(() => setFrame((f) => (f + 1) % 600), tick);
    return () => clearInterval(id);
  }, [animate, mood]);

  const all = robot(mood, frame);
  const lines = compact ? all.slice(0, 6) : all; // drop the treads row for the head

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
      {/* speech bubble — a small rounded callout, tail toward his antenna */}
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
