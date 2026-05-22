/**
 * commandsFromDaemonNames — synthesizes SlashCommand stubs from the
 * daemon's `system_init.slash_commands: string[]` payload so plugin
 * commands appear in the SlashCommandPalette.
 *
 * Captures the user-blocking 2026-05-02 bug: plugin commands installed
 * via /plugin (e.g. `superpowers:test-driven-development`) never showed
 * in the slash autocomplete because the palette only read the static
 * SLASH_COMMANDS registry. This test pins the contract.
 */
import { describe, it, expect } from 'vitest';
import {
  commandsFromDaemonNames,
  filterSlashCommands,
  SLASH_COMMANDS,
} from '../slashCommands';

describe('commandsFromDaemonNames', () => {
  it('returns [] for empty/missing input', () => {
    expect(commandsFromDaemonNames([])).toEqual([]);
    // null and undefined coerce through the type but the function
    // must not throw — guard against daemon shape drift.
    expect(commandsFromDaemonNames(undefined as any)).toEqual([]);
  });

  it('synthesizes a SlashCommand for each unknown plugin name', () => {
    const cmds = commandsFromDaemonNames([
      'superpowers:test-driven-development',
      'superpowers:brainstorming',
    ]);
    expect(cmds).toHaveLength(2);
    expect(cmds[0].name).toBe('superpowers:test-driven-development');
    expect(cmds[0].priority).toBe('p1');
    // Plugin-prefix surfaced in the description so users can scan source.
    expect(cmds[0].description).toContain('superpowers');
  });

  it('skips names already in the static registry (no dupes)', () => {
    // /help and /clear are baseline built-ins.
    const cmds = commandsFromDaemonNames(['help', 'clear', 'something:new']);
    expect(cmds.map((c) => c.name)).toEqual(['something:new']);
  });

  it('strips leading slash and trims', () => {
    const cmds = commandsFromDaemonNames(['  /plugin:foo  ']);
    expect(cmds[0].name).toBe('plugin:foo');
  });

  it('filters non-string entries', () => {
    const cmds = commandsFromDaemonNames(['real:cmd', null as any, 42 as any]);
    expect(cmds.map((c) => c.name)).toEqual(['real:cmd']);
  });
});

describe('filterSlashCommands with extraCommands', () => {
  it('matches plugin commands by prefix in palette filter', () => {
    const extras = commandsFromDaemonNames([
      'superpowers:test-driven-development',
      'superpowers:brainstorming',
    ]);
    const results = filterSlashCommands('super', 50, extras);
    const names = results.map((r) => r.name);
    expect(names).toContain('superpowers:test-driven-development');
    expect(names).toContain('superpowers:brainstorming');
  });

  it('matches plugin commands by substring (e.g. typing "tdd")', () => {
    const extras = commandsFromDaemonNames(['superpowers:test-driven-development']);
    const results = filterSlashCommands('test-driven', 50, extras);
    expect(results.map((r) => r.name)).toContain(
      'superpowers:test-driven-development',
    );
  });

  it('preserves built-in commands when extras are present', () => {
    const extras = commandsFromDaemonNames(['plugin:foo']);
    const results = filterSlashCommands('help', 50, extras);
    // Built-in /help still wins for "help" query.
    expect(results.map((r) => r.name)).toContain('help');
  });

  it('extras=[] is identical to legacy filterSlashCommands(query, limit)', () => {
    const a = filterSlashCommands('config', 50, []);
    const b = filterSlashCommands('config', 50);
    expect(a.map((c) => c.name)).toEqual(b.map((c) => c.name));
  });

  it('static registry remains unmodified', () => {
    const before = SLASH_COMMANDS.length;
    commandsFromDaemonNames(['plugin:a', 'plugin:b', 'plugin:c']);
    expect(SLASH_COMMANDS.length).toBe(before);
  });
});
