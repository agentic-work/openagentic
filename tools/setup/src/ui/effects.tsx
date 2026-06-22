import React from 'react';
import { Text } from 'ink';

/** lerp two #rrggbb hexes */
export function hexLerp(a: string, b: string, t: number): string {
  const pa = [Number.parseInt(a.slice(1, 3), 16), Number.parseInt(a.slice(3, 5), 16), Number.parseInt(a.slice(5, 7), 16)];
  const pb = [Number.parseInt(b.slice(1, 3), 16), Number.parseInt(b.slice(3, 5), 16), Number.parseInt(b.slice(5, 7), 16)];
  const c = pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.max(0, Math.min(1, t))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

/** sample a multi-stop gradient at 0..1 */
export function gradColor(stops: string[], t: number): string {
  if (stops.length === 1) return stops[0];
  const seg = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(seg));
  return hexLerp(stops[i], stops[i + 1], seg - i);
}

/** per-character gradient text */
export const Grad: React.FC<{ text: string; stops: string[]; bold?: boolean; dim?: boolean }> = ({
  text,
  stops,
  bold,
  dim,
}) => {
  const chars = [...text];
  const n = Math.max(1, chars.length - 1);
  return (
    <Text>
      {chars.map((ch, i) => (
        <Text key={i} color={gradColor(stops, i / n)} bold={bold} dimColor={dim}>
          {ch}
        </Text>
      ))}
    </Text>
  );
};

/** a full-width gradient rule */
export const Rule: React.FC<{ width: number; stops: string[]; char?: string }> = ({ width, stops, char = '─' }) => {
  const n = Math.max(1, width - 1);
  return (
    <Text>
      {Array.from({ length: width }, (_, i) => (
        <Text key={i} color={gradColor(stops, i / n)}>
          {char}
        </Text>
      ))}
    </Text>
  );
};

/** a slim progress bar — filled is gradient, the rest is a hairline track */
export const Bar: React.FC<{ value: number; total: number; width: number; stops: string[]; track?: string }> = ({
  value,
  total,
  width,
  stops,
  track = '#2C3A31',
}) => {
  const filled = Math.max(0, Math.min(width, Math.round((value / Math.max(1, total)) * width)));
  const n = Math.max(1, width - 1);
  return (
    <Text>
      {Array.from({ length: width }, (_, i) =>
        i < filled ? (
          <Text key={i} color={gradColor(stops, i / n)}>
            ━
          </Text>
        ) : (
          <Text key={i} color={track}>
            ─
          </Text>
        ),
      )}
    </Text>
  );
};
