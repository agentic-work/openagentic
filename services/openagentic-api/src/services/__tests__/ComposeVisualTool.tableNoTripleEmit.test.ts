/**
 * Sev-1 audit (2026-05-12 round 2): when `compose_visual` runs with
 * `template: 'table'`, multiple artifact surfaces used to fire. A1
 * (2026-05-12) ripped the opcode-4 dual-emit; the surviving table
 * surfaces are:
 *
 *   1. ctx.emit('streaming_table', ...) — legacy frame, UI's
 *      applyStreamingTableFrame reducer consumes it.
 *   2. ctx.emit('visual_render', ...) — legacy back-compat frame.
 *
 * For `template:'table'`, result.artifact is suppressed so chatLoop
 * doesn't try to push another artifact frame from r.result.artifact.
 */

import { describe, it, expect } from 'vitest';
import { executeComposeVisual } from '../ComposeVisualTool.js';

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as any;

describe('compose_visual table — no triple emit (Sev-1 round 2 audit)', () => {
  it('does NOT return result.artifact when template is table (chatLoop opcode-4 suppressed)', async () => {
    const result = await executeComposeVisual(
      {
        emit: () => {},
        logger: silentLogger,
        sessionId: 's',
      },
      {
        template: 'table',
        data: { columns: ['a'], rows: [['x']] },
        title: 'T',
      } as any,
    );

    expect(result.ok).toBe(true);
    // Table template emits streaming_table opcode-4 directly; chatLoop
    // MUST NOT emit another opcode-4 from r.result.artifact. The
    // simplest contract: artifact is undefined for table template.
    expect(result.artifact).toBeUndefined();
  });

  it('table template emits legacy streaming_table + visual_render (opcode-4 dual-emit ripped per A1)', async () => {
    const emitted: Array<{ event: string; payload: any }> = [];
    await executeComposeVisual(
      {
        emit: (event, payload) => emitted.push({ event, payload: payload as any }),
        logger: silentLogger,
        sessionId: 's',
      },
      {
        template: 'table',
        data: { columns: ['name'], rows: [['a']] },
      } as any,
    );

    const events = emitted.map((e) => e.event);
    // Table surfaces remaining post-A1: named streaming_table + legacy
    // visual_render (backward compat for the old reducer path).
    expect(events).toContain('streaming_table');
    expect(events).toContain('visual_render');
    // A1: opcode-4 dual-emit ripped — UI never consumed it.
    expect(events).not.toContain('4');
  });

  it('non-table templates STILL return result.artifact for chatLoop opcode-4', async () => {
    const result = await executeComposeVisual(
      {
        emit: () => {},
        logger: silentLogger,
        sessionId: 's',
      },
      {
        template: 'bar_chart',
        title: 'My Chart',
        data: { x: ['Jan', 'Feb'], y: [10, 20] },
      } as any,
    );
    expect(result.ok).toBe(true);
    expect(result.artifact).toBeDefined();
    expect(result.artifact!.kind).toBe('visual_render');
  });
});
