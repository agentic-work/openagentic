import { promises as fs } from 'fs'; import { join } from 'path';
export async function writeClaudeSettings(home: string, opts: { model?: string }): Promise<void> {
  const dir = join(home, '.claude');
  await fs.mkdir(dir, { recursive: true });
  const settings: Record<string, unknown> = {
    $schema: 'https://json.schemastore.org/claude-code-settings.json',
    // bypassPermissions as the DEFAULT mode skips all permission checks AND
    // suppresses the first-run "Bypass Permissions mode" acceptance dialog +
    // the trust-this-folder prompt (vs the --dangerously-skip-permissions flag,
    // which enters the same mode but shows a blocking one-time acceptance).
    // Safe: exec runs non-root in an isolated container on the user's own workspace.
    permissions: { defaultMode: 'bypassPermissions' },
    feedbackSurveyRate: 0,
  };
  if (opts.model) settings.model = opts.model;
  await fs.writeFile(join(dir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');

  // ~/.claude.json (machine-local user config) holds first-run onboarding state.
  // Pre-completing it makes the TUI skip the theme picker / first-run dialogs so a
  // PTY session drops straight to a usable prompt instead of blocking on input.
  const userConfig = { hasCompletedOnboarding: true, theme: 'auto' };
  await fs.writeFile(join(home, '.claude.json'), JSON.stringify(userConfig, null, 2), 'utf8');
}
