import { describe, it, expect } from 'vitest';
import { classifySlashInput } from '../slashIntercept';

describe('classifySlashInput', () => {
  describe('native React pickers', () => {
    it.each([
      ['/skills', 'skills'],
      ['/SKILLS', 'skills'],
      ['/skills foo', 'skills'],
      ['/plugin', 'plugins'],
      ['/plugins', 'plugins'],
      ['/plugins install foo', 'plugins'],
      ['/model', 'model'],
      ['/model gpt-oss:20b', 'model'],
      ['/mcp', 'mcp'],
      ['/agents', 'agents'],
    ])('classifies %s as picker:%s', (input, expectedPicker) => {
      const result = classifySlashInput(input);
      expect(result.kind).toBe('picker');
      if (result.kind === 'picker') {
        expect(result.picker).toBe(expectedPicker);
      }
    });
  });

  describe('/reload-plugins → control_request', () => {
    it('classifies bare /reload-plugins as control_request', () => {
      const result = classifySlashInput('/reload-plugins');
      expect(result).toEqual({
        kind: 'control_request',
        subtype: 'reload_plugins',
      });
    });

    it('case-insensitive match', () => {
      const result = classifySlashInput('/Reload-Plugins');
      expect(result.kind).toBe('control_request');
      if (result.kind === 'control_request') {
        expect(result.subtype).toBe('reload_plugins');
      }
    });

    it('ignores trailing args (no args parameter for reload_plugins)', () => {
      const result = classifySlashInput('/reload-plugins trailing junk');
      expect(result).toEqual({
        kind: 'control_request',
        subtype: 'reload_plugins',
      });
    });
  });

  describe('/compact → control_request', () => {
    it('classifies bare /compact as control_request without args', () => {
      const result = classifySlashInput('/compact');
      expect(result).toEqual({
        kind: 'control_request',
        subtype: 'compact',
      });
    });

    it('forwards trailing instructions as args', () => {
      const result = classifySlashInput(
        '/compact focus on the deployment failures only',
      );
      expect(result).toEqual({
        kind: 'control_request',
        subtype: 'compact',
        args: 'focus on the deployment failures only',
      });
    });

    it('drops empty/whitespace-only args', () => {
      const result = classifySlashInput('/compact    ');
      expect(result).toEqual({
        kind: 'control_request',
        subtype: 'compact',
      });
    });

    it('case-insensitive match', () => {
      const result = classifySlashInput('/COMPACT');
      expect(result.kind).toBe('control_request');
      if (result.kind === 'control_request') {
        expect(result.subtype).toBe('compact');
      }
    });
  });

  // AC#2 T38 (audit 2026-05-04): /context can't run via the headless
  // slash dispatcher because context-noninteractive needs a live
  // ToolUseContext (messages, tools, agentDefinitions). The openagentic
  // child already implements `get_context_usage` as a control_request
  // (cli/print.ts:3063) running inside the live query loop where state
  // is available. Route /context through that path.
  describe('/context → control_request {subtype: get_context_usage}', () => {
    it('classifies /context as a get_context_usage control_request', () => {
      const result = classifySlashInput('/context');
      expect(result.kind).toBe('control_request');
      if (result.kind === 'control_request') {
        expect(result.subtype).toBe('get_context_usage');
      }
    });

    it('handles trailing whitespace + extra args', () => {
      const result = classifySlashInput('/context  ');
      expect(result.kind).toBe('control_request');
    });

    it('is case-insensitive (matches the other slash classifiers)', () => {
      const result = classifySlashInput('/CONTEXT');
      expect(result.kind).toBe('control_request');
    });
  });

  describe('forward path', () => {
    it.each([
      'hello world',
      '/help',
      '/cost',
      '/unknown-command',
      '',
      'just a regular message',
    ])('forwards %s', (input) => {
      const result = classifySlashInput(input);
      expect(result.kind).toBe('forward');
    });
  });
});
