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
 * Credential Rotation Modal — Modal for rotating provider credentials.
 */
import React, { useState } from 'react';
import { Key } from '@/shared/icons';
import { RefreshCw } from '../../Shared/AdminIcons';
import { FormField } from './ProviderFormPanel';
import {
  type DbProvider, PROVIDER_META,
  inputCls, inputStyle, btnPrimary, btnSecondary,
} from './types';

export const CredentialRotationModal: React.FC<{
  provider: DbProvider;
  onClose: () => void;
  onRotate: (newCreds: Record<string, string>) => void;
  rotating: boolean;
}> = ({ provider, onClose, onRotate, rotating }) => {
  const meta = PROVIDER_META[provider.provider_type] || PROVIDER_META.ollama;
  const [creds, setCreds] = useState<Record<string, string>>({});

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="rounded-xl border shadow-2xl w-full max-w-md p-6 space-y-4" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Rotate Credentials: {provider.display_name}
        </h3>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Enter new credentials. Old credentials will be replaced immediately.</p>
        {meta.authFields.filter(f => f.type === 'password' || f.required).map(field => (
          <FormField key={field.key} label={field.label} required={field.required}>
            <input type="password" value={creds[field.key] || ''} onChange={e => setCreds(prev => ({ ...prev, [field.key]: e.target.value }))}
              placeholder={`New ${field.label.toLowerCase()}`} className={inputCls} style={inputStyle} />
          </FormField>
        ))}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className={btnSecondary} style={{ borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}>Cancel</button>
          <button onClick={() => onRotate(creds)} disabled={rotating} className={btnPrimary}>
            {rotating ? <><RefreshCw size={14} className="inline animate-spin mr-1" /> Rotating...</> : <><Key size={14} className="inline mr-1" /> Rotate</>}
          </button>
        </div>
      </div>
    </div>
  );
};
