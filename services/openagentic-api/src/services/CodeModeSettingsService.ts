/**
 * CodeModeSettingsService
 *
 * Reads and writes the `codeMode` sub-object stored in `User.settings`
 * (via UserSettingsService). Provides typed get/set helpers so route
 * handlers never have to know the JSON nesting.
 *
 * codeMode shape:
 *   {
 *     firstRunComplete: boolean;  // default false
 *     lastModel?:     string;
 *     lastWorkspace?: string;
 *   }
 */

export interface CodeModeSettings {
  firstRunComplete: boolean;
  lastModel?: string;
  lastWorkspace?: string;
}

/**
 * Minimal interface for the UserSettingsService dependency so the
 * service can be unit-tested with a stub (no real DB required).
 */
export interface IUserSettingsService {
  getUserSettings(userId: string): Promise<{ settings?: Record<string, any>; [key: string]: any }>;
  updateUserSettings(userId: string, updates: { settings?: Record<string, any> }): Promise<any>;
}

const DEFAULT_CODE_MODE_SETTINGS: CodeModeSettings = { firstRunComplete: false };

export class CodeModeSettingsService {
  private readonly userSettings: IUserSettingsService;

  constructor(userSettingsService: IUserSettingsService) {
    this.userSettings = userSettingsService;
  }

  /**
   * Read the `codeMode` sub-object for a user.
   * Returns `{ firstRunComplete: false }` when no entry exists yet.
   */
  async getCodeModeSettings(userId: string): Promise<CodeModeSettings> {
    const userSettings = await this.userSettings.getUserSettings(userId);
    const settings = (userSettings.settings as Record<string, any>) ?? {};
    const codeMode = settings.codeMode as CodeModeSettings | undefined;

    if (!codeMode) {
      return { ...DEFAULT_CODE_MODE_SETTINGS };
    }

    return {
      firstRunComplete: codeMode.firstRunComplete ?? false,
      ...(codeMode.lastModel !== undefined ? { lastModel: codeMode.lastModel } : {}),
      ...(codeMode.lastWorkspace !== undefined ? { lastWorkspace: codeMode.lastWorkspace } : {}),
    };
  }

  /**
   * Merge `partial` into the stored `codeMode` sub-object.
   * Performs a shallow merge — callers only need to supply the fields they want changed.
   */
  async setCodeModeSettings(userId: string, partial: Partial<CodeModeSettings>): Promise<void> {
    // Read current state so we don't clobber other fields in the codeMode block.
    const current = await this.getCodeModeSettings(userId);
    const merged: CodeModeSettings = { ...current, ...partial };

    await this.userSettings.updateUserSettings(userId, {
      settings: { codeMode: merged },
    });
  }
}
