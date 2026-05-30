import React from 'react';
import { AuthProvider } from './AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { MCPProvider } from './MCPContext';
import { ConfirmProvider } from '@/shared/hooks/useConfirm';

interface AppProvidersProps {
  children: React.ReactNode;
}

/**
 * App-level providers wrapper
 * Composes all context providers in the correct order
 */
export const AppProviders: React.FC<AppProvidersProps> = ({ children }) => {
  return (
    <AuthProvider>
      <ThemeProvider>
        <MCPProvider>
          <ConfirmProvider>
            {children}
          </ConfirmProvider>
        </MCPProvider>
      </ThemeProvider>
    </AuthProvider>
  );
};

export { useAuth } from './AuthContext';
export { useTheme } from '@/contexts/ThemeContext';
export { MCPContext } from './MCPContext';