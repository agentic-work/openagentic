import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodeModeSettingsService } from '../CodeModeSettingsService.js';

describe('CodeModeSettingsService', () => {
  let mockUserSettingsService: {
    getUserSettings: ReturnType<typeof vi.fn>;
    updateUserSettings: ReturnType<typeof vi.fn>;
  };
  let service: CodeModeSettingsService;

  beforeEach(() => {
    mockUserSettingsService = {
      getUserSettings: vi.fn(),
      updateUserSettings: vi.fn(),
    };
    service = new CodeModeSettingsService(mockUserSettingsService as any);
  });

  describe('getCodeModeSettings', () => {
    it('returns { firstRunComplete: false } when codeMode key is absent', async () => {
      mockUserSettingsService.getUserSettings.mockResolvedValue({
        theme: 'dark',
        settings: {},
        accessibility_settings: {},
        ui_preferences: {},
      });

      const result = await service.getCodeModeSettings('user-1');

      expect(result).toEqual({ firstRunComplete: false });
    });

    it('returns stored codeMode settings when they exist', async () => {
      mockUserSettingsService.getUserSettings.mockResolvedValue({
        theme: 'dark',
        settings: {
          codeMode: {
            firstRunComplete: true,
            lastModel: 'claude-sonnet',
            lastWorkspace: 'https://github.com/org/repo',
          },
        },
        accessibility_settings: {},
        ui_preferences: {},
      });

      const result = await service.getCodeModeSettings('user-1');

      expect(result).toEqual({
        firstRunComplete: true,
        lastModel: 'claude-sonnet',
        lastWorkspace: 'https://github.com/org/repo',
      });
    });

    it('returns { firstRunComplete: false } when settings object has no codeMode', async () => {
      mockUserSettingsService.getUserSettings.mockResolvedValue({
        theme: 'dark',
        settings: { someOtherKey: 'value' },
        accessibility_settings: {},
        ui_preferences: {},
      });

      const result = await service.getCodeModeSettings('user-1');

      expect(result).toEqual({ firstRunComplete: false });
    });
  });

  describe('setCodeModeSettings', () => {
    it('merges partial update into existing codeMode settings', async () => {
      mockUserSettingsService.getUserSettings.mockResolvedValue({
        theme: 'dark',
        settings: {
          codeMode: {
            firstRunComplete: false,
          },
        },
        accessibility_settings: {},
        ui_preferences: {},
      });
      mockUserSettingsService.updateUserSettings.mockResolvedValue({});

      await service.setCodeModeSettings('user-1', {
        firstRunComplete: true,
        lastModel: 'm',
      });

      expect(mockUserSettingsService.updateUserSettings).toHaveBeenCalledWith(
        'user-1',
        {
          settings: {
            codeMode: {
              firstRunComplete: true,
              lastModel: 'm',
            },
          },
        },
      );
    });

    it('round-trip: after set, get returns updated values', async () => {
      // Simulate a real in-memory store for round-trip test
      let storedSettings: Record<string, any> = {};

      mockUserSettingsService.getUserSettings.mockImplementation(async () => ({
        theme: 'dark',
        settings: storedSettings,
        accessibility_settings: {},
        ui_preferences: {},
      }));

      mockUserSettingsService.updateUserSettings.mockImplementation(
        async (_userId: string, updates: any) => {
          if (updates.settings) {
            storedSettings = { ...storedSettings, ...updates.settings };
          }
          return {};
        },
      );

      // Initial read → default
      const before = await service.getCodeModeSettings('user-1');
      expect(before).toEqual({ firstRunComplete: false });

      // Write
      await service.setCodeModeSettings('user-1', {
        firstRunComplete: true,
        lastModel: 'm',
      });

      // Read again → updated values
      const after = await service.getCodeModeSettings('user-1');
      expect(after).toEqual({ firstRunComplete: true, lastModel: 'm' });
    });
  });
});
