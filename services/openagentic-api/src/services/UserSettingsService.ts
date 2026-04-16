/**
 * UserSettingsService - Comprehensive user preference and settings management
 */

import type { Logger } from 'pino';
import { prisma } from '../utils/prisma.js';

export type Theme = 'light' | 'dark' | 'system';

export interface UserSettings {
  theme: Theme;
  settings: Record<string, any>;
  accessibility_settings: Record<string, any>;
  ui_preferences: Record<string, any>;
  notification_preferences?: Record<string, any>;
  privacy_settings?: Record<string, any>;
  experimental_features?: Record<string, boolean>;
}

export interface UserSettingsUpdate {
  theme?: Theme;
  settings?: Record<string, any>;
  accessibility_settings?: Record<string, any>;
  ui_preferences?: Record<string, any>;
  notification_preferences?: Record<string, any>;
  privacy_settings?: Record<string, any>;
  experimental_features?: Record<string, boolean>;
}

export interface AccessibilitySettings {
  fontSize?: 'small' | 'medium' | 'large' | 'extra-large';
  contrast?: 'normal' | 'high';
  motion?: 'full' | 'reduced';
  screenReader?: boolean;
  keyboardNavigation?: boolean;
  colorBlindness?: 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia';
}

export interface UIPreferences {
  sidebarWidth?: number;
  compactMode?: boolean;
  showTimestamps?: boolean;
  messageGrouping?: boolean;
  autoScroll?: boolean;
  syntaxHighlighting?: boolean;
  codeTheme?: string;
  language?: string;
  timezone?: string;
}

export interface NotificationSettings {
  email?: boolean;
  push?: boolean;
  inApp?: boolean;
  mentions?: boolean;
  newMessages?: boolean;
  systemUpdates?: boolean;
  quietHours?: {
    enabled: boolean;
    start: string;
    end: string;
  };
}

export interface PrivacySettings {
  profileVisibility?: 'public' | 'private' | 'limited';
  activityStatus?: boolean;
  dataSharing?: boolean;
  analyticsOptOut?: boolean;
  cookiePreferences?: Record<string, boolean>;
}

/**
 * Service for user settings and preferences management
 * Handles theme, accessibility, UI preferences, and more
 */
export class UserSettingsService {
  private logger: Logger;
  private readonly defaultSettings: UserSettings;

  constructor(logger: Logger) {
    this.logger = logger.child({ service: 'UserSettingsService' }) as Logger;
    
    this.defaultSettings = {
      theme: 'dark',
      settings: {},
      accessibility_settings: {
        fontSize: 'medium',
        contrast: 'normal',
        motion: 'full',
        screenReader: false,
        keyboardNavigation: false,
        colorBlindness: 'none'
      },
      ui_preferences: {
        sidebarWidth: 280,
        compactMode: false,
        showTimestamps: true,
        messageGrouping: true,
        autoScroll: true,
        syntaxHighlighting: true,
        codeTheme: 'dark',
        language: 'en',
        timezone: 'UTC'
      },
      notification_preferences: {
        email: true,
        push: true,
        inApp: true,
        mentions: true,
        newMessages: false,
        systemUpdates: true,
        quietHours: {
          enabled: false,
          start: '22:00',
          end: '08:00'
        }
      },
      privacy_settings: {
        profileVisibility: 'limited',
        activityStatus: true,
        dataSharing: false,
        analyticsOptOut: false,
        cookiePreferences: {
          necessary: true,
          analytics: false,
          marketing: false,
          preferences: true
        }
      },
      experimental_features: {}
    };
  }

  /**
   * Get user settings with fallback to defaults
   */
  async getUserSettings(userId: string): Promise<UserSettings> {
    this.logger.info({ userId }, 'Fetching user settings');

    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          theme: true,
          settings: true,
          accessibility_settings: true,
          ui_preferences: true,
          updated_at: true
        }
      });

      if (!user) {
        this.logger.warn({ userId }, 'User not found, returning default settings');
        return this.defaultSettings;
      }

      // Merge with defaults to ensure all fields are present
      const settings: UserSettings = {
        theme: (user.theme as Theme) || this.defaultSettings.theme,
        settings: { ...this.defaultSettings.settings, ...(user.settings as any || {}) },
        accessibility_settings: { 
          ...this.defaultSettings.accessibility_settings, 
          ...(user.accessibility_settings as any || {}) 
        },
        ui_preferences: {
          ...this.defaultSettings.ui_preferences,
          ...(user.ui_preferences as any || {})
        }
      };

      this.logger.info({ userId, theme: settings.theme }, 'User settings retrieved');
      return settings;
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to fetch user settings');
      throw new Error(`Failed to fetch user settings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Update user settings (partial update)
   */
  async updateUserSettings(userId: string, updates: UserSettingsUpdate): Promise<UserSettings> {
    this.logger.info({
      userId,
      updateKeys: Object.keys(updates)
    }, 'Updating user settings');

    try {
      // Validate theme if provided
      if (updates.theme && !['light', 'dark', 'system'].includes(updates.theme)) {
        throw new Error('Invalid theme value. Must be "light", "dark", or "system"');
      }

      // Validate accessibility settings
      if (updates.accessibility_settings) {
        this.validateAccessibilitySettings(updates.accessibility_settings);
      }

      // Validate UI preferences
      if (updates.ui_preferences) {
        this.validateUIPreferences(updates.ui_preferences);
      }

      // Get current settings for merging
      const currentSettings = await this.getUserSettings(userId);

      // Prepare update data
      const updateData: any = {
        updated_at: new Date()
      };

      if (updates.theme !== undefined) {
        updateData.theme = updates.theme;
      }
      if (updates.settings !== undefined) {
        updateData.settings = { ...currentSettings.settings, ...updates.settings };
      }
      if (updates.accessibility_settings !== undefined) {
        updateData.accessibility_settings = { 
          ...currentSettings.accessibility_settings, 
          ...updates.accessibility_settings 
        };
      }

      // Update in database
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          theme: true,
          settings: true,
          accessibility_settings: true,
          ui_preferences: true
        }
      });

      // Return complete settings
      const newSettings = await this.getUserSettings(userId);
      
      this.logger.info({
        userId,
        updatedFields: Object.keys(updates)
      }, 'User settings updated successfully');

      return newSettings;
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to update user settings');
      throw new Error(`Failed to update user settings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Update only the theme
   */
  async updateTheme(userId: string, theme: Theme): Promise<{ theme: Theme }> {
    this.logger.info({ userId, theme }, 'Updating user theme');

    try {
      if (!['light', 'dark', 'system'].includes(theme)) {
        throw new Error('Invalid theme value. Must be "light", "dark", or "system"');
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: { 
          theme,
          updated_at: new Date()
        },
        select: { theme: true }
      });

      this.logger.info({ userId, newTheme: theme }, 'Theme updated successfully');
      return { theme: updatedUser.theme as Theme };
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to update theme');
      throw new Error(`Failed to update theme: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Reset settings to defaults
   */
  async resetSettings(userId: string): Promise<UserSettings> {
    this.logger.info({ userId }, 'Resetting user settings to defaults');

    try {
      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          theme: this.defaultSettings.theme,
          settings: this.defaultSettings.settings,
          accessibility_settings: this.defaultSettings.accessibility_settings,
          ui_preferences: this.defaultSettings.ui_preferences || {},
          updated_at: new Date()
        },
        select: {
          theme: true,
          settings: true,
          accessibility_settings: true,
          ui_preferences: true
        }
      });

      this.logger.info({ userId }, 'Settings reset to defaults successfully');
      return this.defaultSettings;
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to reset settings');
      throw new Error(`Failed to reset settings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get settings schema/defaults for client
   */
  getSettingsSchema(): {
    defaults: UserSettings;
    themes: Theme[];
    accessibilityOptions: any;
    uiOptions: any;
  } {
    return {
      defaults: this.defaultSettings,
      themes: ['light', 'dark', 'system'],
      accessibilityOptions: {
        fontSize: ['small', 'medium', 'large', 'extra-large'],
        contrast: ['normal', 'high'],
        motion: ['full', 'reduced'],
        colorBlindness: ['none', 'protanopia', 'deuteranopia', 'tritanopia']
      },
      uiOptions: {
        codeThemes: ['light', 'dark', 'monokai', 'github', 'solarized'],
        languages: ['en', 'es', 'fr', 'de', 'ja', 'zh'],
        timezones: [
          'UTC', 'America/New_York', 'America/Los_Angeles', 
          'Europe/London', 'Europe/Berlin', 'Asia/Tokyo', 'Asia/Shanghai'
        ]
      }
    };
  }

  /**
   * Export user settings for backup/migration
   */
  async exportSettings(userId: string): Promise<UserSettings & { exportedAt: Date; userId: string }> {
    try {
      const settings = await this.getUserSettings(userId);
      return {
        ...settings,
        userId,
        exportedAt: new Date()
      };
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to export settings');
      throw new Error(`Failed to export settings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Import user settings from backup
   */
  async importSettings(userId: string, settingsData: Partial<UserSettings>): Promise<UserSettings> {
    this.logger.info({ userId }, 'Importing user settings');

    try {
      // Filter out invalid keys and validate data
      const validUpdates: UserSettingsUpdate = {};

      if (settingsData.theme && ['light', 'dark', 'system'].includes(settingsData.theme)) {
        validUpdates.theme = settingsData.theme;
      }

      if (settingsData.settings) {
        validUpdates.settings = settingsData.settings;
      }

      if (settingsData.accessibility_settings) {
        this.validateAccessibilitySettings(settingsData.accessibility_settings);
        validUpdates.accessibility_settings = settingsData.accessibility_settings;
      }

      if (settingsData.ui_preferences) {
        this.validateUIPreferences(settingsData.ui_preferences);
        validUpdates.ui_preferences = settingsData.ui_preferences;
      }

      return await this.updateUserSettings(userId, validUpdates);
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to import settings');
      throw new Error(`Failed to import settings: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Health check for the service
   */
  async healthCheck(): Promise<{ healthy: boolean; details: any }> {
    try {
      // Test database connectivity
      await prisma.user.count({ take: 1 });
      
      return {
        healthy: true,
        details: {
          defaultsLoaded: !!this.defaultSettings,
          supportedThemes: ['light', 'dark', 'system'],
          settingsCategories: ['theme', 'accessibility', 'ui', 'notifications', 'privacy']
        }
      };
    } catch (error) {
      return {
        healthy: false,
        details: { error: error instanceof Error ? error.message : String(error) }
      };
    }
  }

  // Private helper methods

  private validateAccessibilitySettings(settings: Record<string, any>): void {
    if (settings.fontSize && !['small', 'medium', 'large', 'extra-large'].includes(settings.fontSize)) {
      throw new Error('Invalid fontSize value');
    }
    
    if (settings.contrast && !['normal', 'high'].includes(settings.contrast)) {
      throw new Error('Invalid contrast value');
    }
    
    if (settings.motion && !['full', 'reduced'].includes(settings.motion)) {
      throw new Error('Invalid motion value');
    }
    
    if (settings.colorBlindness && !['none', 'protanopia', 'deuteranopia', 'tritanopia'].includes(settings.colorBlindness)) {
      throw new Error('Invalid colorBlindness value');
    }
  }

  private validateUIPreferences(preferences: Record<string, any>): void {
    if (preferences.sidebarWidth && (typeof preferences.sidebarWidth !== 'number' || preferences.sidebarWidth < 200 || preferences.sidebarWidth > 500)) {
      throw new Error('Invalid sidebarWidth value (must be between 200-500)');
    }
    
    if (preferences.language && typeof preferences.language !== 'string') {
      throw new Error('Invalid language value');
    }
    
    if (preferences.timezone && typeof preferences.timezone !== 'string') {
      throw new Error('Invalid timezone value');
    }
  }
}