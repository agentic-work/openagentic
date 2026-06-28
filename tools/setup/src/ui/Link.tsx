import React from 'react';
import { Text } from 'ink';
import { COLORS } from './Theme.tsx';

// OSC-8 terminal hyperlink. Emits  ESC ] 8 ; ; <url> ESC \  <text>  ESC ] 8 ; ; ESC \
// Terminals that grok OSC-8 (iTerm2, WezTerm, kitty, recent GNOME Terminal, …)
// render <text> as a clickable link; everywhere else the escapes are inert and
// the plain styled text shows through. ESC is built from char code 27 so the
// raw byte is never embedded in source.
const ESC = String.fromCharCode(27);
const ST = `${ESC}\\`; // string terminator: ESC \

/** Wrap visible text in an OSC-8 hyperlink escape pointing at url. */
export function osc8(url: string, text: string): string {
  return `${ESC}]8;;${url}${ST}${text}${ESC}]8;;${ST}`;
}

/** A clickable hyperlink, styled in the brand signal-orange + underline. */
export const Link: React.FC<{ url: string; text: string }> = ({ url, text }) => (
  <Text color={COLORS.signal} underline>
    {osc8(url, text)}
  </Text>
);

export default Link;
