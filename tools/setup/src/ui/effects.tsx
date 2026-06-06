import React from 'react';
import { Text } from 'ink';

/** lerp two #rrggbb hexes */
export function hexLerp(a: string, b: string, t: number): string {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)];
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)];
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

/** per-character gradient text. `shift` animates the gradient sideways. */
export const Grad: React.FC<{ text: string; stops: string[]; bold?: boolean; shift?: number }> = ({
  text,
  stops,
  bold,
  shift = 0,
}) => {
  const chars = [...text];
  const n = Math.max(1, chars.length - 1);
  return (
    <Text>
      {chars.map((ch, i) => (
        <Text key={i} color={gradColor(stops, ((i + shift) % chars.length) / n)} bold={bold}>
          {ch}
        </Text>
      ))}
    </Text>
  );
};

/**
 * an animated rule: a dim baseline with a bright gradient spot sweeping across,
 * like a scanline / signal trace. `frame` drives the sweep.
 */
export const ScanRule: React.FC<{ width: number; frame: number; stops: string[]; dim?: string }> = ({
  width,
  frame,
  stops,
  dim = '#243329',
}) => {
  const span = width + 10;
  const pos = (frame % span) - 5;
  return (
    <Text>
      {Array.from({ length: width }, (_, i) => {
        const d = Math.abs(i - pos);
        const lit = d < 4;
        return (
          <Text key={i} color={lit ? gradColor(stops, 1 - d / 4) : dim} bold={d < 1.5}>
            {d < 1 ? '━' : '─'}
          </Text>
        );
      })}
    </Text>
  );
};
