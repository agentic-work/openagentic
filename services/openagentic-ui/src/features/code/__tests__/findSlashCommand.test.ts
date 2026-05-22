/**
 * findSlashCommand — palette-commit decides whether to submit
 * immediately or to insert a stub via SlashCommand.args.
 */
import { describe, it, expect } from 'vitest';
import { findSlashCommand } from '../slashCommands';

describe('findSlashCommand', () => {
  it('resolves a known no-args command by name', () => {
    const c = findSlashCommand('skills');
    expect(c?.name).toBe('skills');
    expect(c?.args).toBeUndefined();
  });

  it('resolves an arg-taking command and surfaces the args hint', () => {
    const c = findSlashCommand('files');
    expect(c?.name).toBe('files');
    // /files has no args declared today (it lists context); used as the
    // canonical "no args" example. /add-dir is the arg-taking case:
    const addDir = findSlashCommand('add-dir');
    expect(addDir?.args).toBe('<path>');
  });

  it('is case-insensitive', () => {
    expect(findSlashCommand('SKILLS')?.name).toBe('skills');
  });

  it('strips a leading slash', () => {
    expect(findSlashCommand('/skills')?.name).toBe('skills');
  });

  it('resolves by alias', () => {
    expect(findSlashCommand('reset')?.name).toBe('clear');
    expect(findSlashCommand('quit')?.name).toBe('exit');
  });

  it('returns undefined when nothing matches', () => {
    expect(findSlashCommand('definitely-not-a-real-cmd')).toBeUndefined();
  });
});
