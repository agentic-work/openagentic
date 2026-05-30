import { describe, it, expect } from 'vitest';
import { promises as fs } from 'fs'; import { tmpdir } from 'os'; import { join } from 'path';
import { writeClaudeSettings } from '../claudeSettings.js';
describe('writeClaudeSettings', () => {
  it('writes acceptEdits + survey-off settings to <home>/.claude/settings.json', async () => {
    const home = await fs.mkdtemp(join(tmpdir(), 'cs-'));
    await writeClaudeSettings(home, { model: 'reg-model-1' });
    const raw = JSON.parse(await fs.readFile(join(home, '.claude', 'settings.json'), 'utf8'));
    expect(raw.permissions.defaultMode).toBe('acceptEdits');
    expect(raw.feedbackSurveyRate).toBe(0);
    expect(raw.model).toBe('reg-model-1');
  });
  it('omits model key when not provided (smart router)', async () => {
    const home = await fs.mkdtemp(join(tmpdir(), 'cs-'));
    await writeClaudeSettings(home, {});
    const raw = JSON.parse(await fs.readFile(join(home, '.claude', 'settings.json'), 'utf8'));
    expect('model' in raw).toBe(false);
  });
  it('writes <home>/.claude.json with onboarding pre-completed so the TUI skips the theme picker', async () => {
    const home = await fs.mkdtemp(join(tmpdir(), 'cs-'));
    await writeClaudeSettings(home, {});
    const cfg = JSON.parse(await fs.readFile(join(home, '.claude.json'), 'utf8'));
    expect(cfg.hasCompletedOnboarding).toBe(true);
    expect(typeof cfg.theme).toBe('string');
  });
});
