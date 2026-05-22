import { describe, it, expect } from 'vitest';
import { findSlashCommand, SLASH_COMMANDS } from '../slashCommands';

describe('slash command TUI parity (2026-05-02 audit)', () => {
  describe('/btw', () => {
    it('is registered', () => {
      expect(findSlashCommand('btw')).toBeDefined();
    });

    it('does not force args (TUI accepts bare /btw and replies "Usage: /btw")', () => {
      const c = findSlashCommand('btw');
      // Bare /btw must submit immediately. Either no args field, OR
      // args + picker so handleSlashSelect's picker branch fires the
      // submit path.
      expect(c?.args === undefined || c?.picker !== undefined).toBe(true);
    });
  });

  describe('/tools', () => {
    it('is registered', () => {
      expect(findSlashCommand('tools')).toBeDefined();
    });

    it('submits bare /tools (TUI lists all tools when no args)', () => {
      const c = findSlashCommand('tools');
      expect(c?.args === undefined || c?.picker !== undefined).toBe(true);
    });
  });

  describe('non-v0.7.0 commands (TUI says "Unknown skill: <name>")', () => {
    // These were captured in the 2026-05-02 TUI run as Unknown skill.
    // Keeping them in the palette gives users a misleading suggestion
    // that the command exists. Either remove from SLASH_COMMANDS, mark
    // hidden, or add a clear "(deprecated / external)" hint.
    const ghosts = ['doctor', 'upgrade', 'migrate-installer'];

    for (const name of ghosts) {
      it(`hides /${name} from the public palette`, () => {
        const c = findSlashCommand(name);
        if (!c) return; // already removed — pass
        expect(c.hidden).toBe(true);
      });
    }
  });
});
