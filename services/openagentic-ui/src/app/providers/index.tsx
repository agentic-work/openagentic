/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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