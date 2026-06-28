import { useState, useEffect } from 'react';

// Settings interface
export interface Settings {
  theme?: 'light' | 'dark';
  [key: string]: any;
}

// Custom hook for settings management
export const useSettings = () => {
  const [settings, setSettings] = useState<Settings>({
    theme: 'dark',
  });

  useEffect(() => {
    // Load settings from localStorage
    const savedSettings = localStorage.getItem('app-settings');
    if (savedSettings) {
      try {
        setSettings(JSON.parse(savedSettings));
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    }
  }, []);

  const updateSettings = (newSettings: Partial<Settings>) => {
    setSettings((prev) => {
      const updated = { ...prev, ...newSettings };
      localStorage.setItem('app-settings', JSON.stringify(updated));
      return updated;
    });
  };

  return {
    settings,
    updateSettings,
  };
};
