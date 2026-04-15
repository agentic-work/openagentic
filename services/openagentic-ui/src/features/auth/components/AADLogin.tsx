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

/**
 * AADLogin - Azure Active Directory Login Component
 * Handles Microsoft/Azure AD authentication flow
 */

import React from 'react';

interface AADLoginProps {
  onLoginSuccess?: () => void;
  onLoginError?: (error: Error) => void;
  className?: string;
}

const AADLogin: React.FC<AADLoginProps> = ({
  onLoginSuccess,
  onLoginError,
  className = ''
}) => {
  return (
    <div className={className}>
      <button
        onClick={() => {
          // Azure AD login flow is handled by AuthContext
          onLoginSuccess?.();
        }}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        Sign in with Microsoft
      </button>
    </div>
  );
};

export default AADLogin;
