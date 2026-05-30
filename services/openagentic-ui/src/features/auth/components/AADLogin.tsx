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
