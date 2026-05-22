#!/usr/bin/env tsx
/**
 * wire-timeline — CLI for the WIRE-CAPTURE NDJSON timeline viewer (Phase 0.1).
 *
 * Usage:
 *   bun scripts/wire-timeline.ts <log-file-path>
 *   bun scripts/wire-timeline.ts <log-file-path> --turnId=<id>
 *   cat capture.log | bun scripts/wire-timeline.ts -
 *
 * Outputs a chronological markdown timeline to stdout. When --out=<path> is
 * passed, also writes the markdown to that file. Each invocation prints a
 * one-line summary to stderr for shell-pipeline visibility.
 *
 * Designed for: dropped into `scripts/run-interleave-harness.sh` to render a
 * per-prompt timeline that's diffed against the matching `.contract.json`.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import {
  parseWireCaptureLog,
  buildTimeline,
  renderTimelineMarkdown,
} from '../src/__tests__/quality/wire-timeline-viewer.js';

interface CliArgs {
  input: string; // path or '-' for stdin
  turnIdFilter?: string;
  outPath?: string;
}

function parseArgs(argv: string[]): CliArgs {
  let input: string | undefined;
  let turnIdFilter: string | undefined;
  let outPath: string | undefined;
  for (const arg of argv) {
    if (arg.startsWith('--turnId=')) {
      turnIdFilter = arg.slice('--turnId='.length);
    } else if (arg.startsWith('--out=')) {
      outPath = arg.slice('--out='.length);
    } else if (!input) {
      input = arg;
    }
  }
  if (!input) {
    throw new Error('Usage: wire-timeline <log-file-or-"-"> [--turnId=<id>] [--out=<path>]');
  }
  return { input, turnIdFilter, outPath };
}

function readInput(input: string): string {
  if (input === '-') {
    return readFileSync(0, 'utf8'); // stdin
  }
  return readFileSync(input, 'utf8');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const text = readInput(args.input);

  const allFrames = parseWireCaptureLog(text);
  const frames = args.turnIdFilter
    ? allFrames.filter((f) => f.turnId === args.turnIdFilter)
    : allFrames;

  if (frames.length === 0) {
    const totalTurns = new Set(allFrames.map((f) => f.turnId)).size;
    process.stderr.write(
      args.turnIdFilter
        ? `No WIRE-CAPTURE frames matched turnId=${args.turnIdFilter} (input had ${totalTurns} distinct turns, ${allFrames.length} frames).\n`
        : `No WIRE-CAPTURE frames found in input.\n`,
    );
    process.exit(1);
  }

  // If multiple turns in the input and no filter, render the largest turn.
  const turnIds = new Set(frames.map((f) => f.turnId));
  let chosenTurn = frames[0].turnId;
  if (turnIds.size > 1 && !args.turnIdFilter) {
    const counts = new Map<string, number>();
    for (const f of frames) counts.set(f.turnId, (counts.get(f.turnId) ?? 0) + 1);
    chosenTurn = [...counts.entries()].sort(([, a], [, b]) => b - a)[0][0];
    process.stderr.write(
      `Multiple turns in input (${turnIds.size}); picking the largest: ${chosenTurn} (${counts.get(chosenTurn)} frames). Use --turnId=<id> to pick another.\n`,
    );
  }
  const turnFrames = frames.filter((f) => f.turnId === chosenTurn);

  const timeline = buildTimeline(turnFrames);
  const md = renderTimelineMarkdown(timeline);

  process.stdout.write(md);
  process.stdout.write('\n');

  if (args.outPath) {
    mkdirSync(dirname(args.outPath), { recursive: true });
    writeFileSync(args.outPath, md + '\n', 'utf8');
    process.stderr.write(`Wrote timeline to ${args.outPath}\n`);
  }

  // One-line summary on stderr.
  const flags: string[] = [];
  if (timeline.summary.duplicateTextPairs > 0) flags.push('DUPLICATE');
  if (timeline.entries.some((e) => e.annotations.includes('COALESCED_BATCH'))) flags.push('COALESCED');
  if (timeline.summary.gaps.length > 0) flags.push(`GAPS=${timeline.summary.gaps.length}`);
  process.stderr.write(
    `[wire-timeline] ${timeline.turnId} · ${timeline.entries.length} frames · ${(timeline.durationMs / 1000).toFixed(1)}s` +
      (flags.length ? ` · ${flags.join(' ')}` : '') +
      '\n',
  );
}

main();
