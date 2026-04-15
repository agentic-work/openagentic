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

import React, { useEffect, useRef } from 'react';

interface SlashCommandModalProps {
  title: string;
  onClose: () => void;
  /** Optional subtitle line under the title. */
  subtitle?: string;
  /** Maximum width in pixels. Default 520. */
  maxWidth?: number;
  children: React.ReactNode;
}

export const SlashCommandModal: React.FC<SlashCommandModalProps> = ({
  title,
  onClose,
  subtitle,
  maxWidth = 520,
  children,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);

  // Esc to close + autofocus first focusable child on open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKey, true);
    // Focus first focusable child in the card (button, input, textarea).
    requestAnimationFrame(() => {
      const el = cardRef.current;
      if (!el) return;
      const focusable = el.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    });
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(13, 17, 23, 0.7)',
        backdropFilter: 'blur(2px)',
        fontFamily:
          'var(--cm-mono-font, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)',
      }}
    >
      <div
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="cm-fade-in"
        style={{
          minWidth: 360,
          maxWidth,
          width: '100%',
          margin: '0 16px',
          backgroundColor: 'var(--cm-bg, #0d1117)',
          border: '1px solid var(--cm-border, #30363d)',
          borderRadius: 8,
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          color: 'var(--cm-text, #e6edf3)',
        }}
      >
        <div
          style={{
            padding: '10px 16px',
            borderBottom: '1px solid var(--cm-border, #30363d)',
            backgroundColor: 'var(--cm-bg-secondary, #161b22)',
            fontSize: 13,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6ch' }}>
            <span style={{ color: 'var(--cm-accent, #58a6ff)' }}>◆</span>
            <span style={{ fontWeight: 600 }}>{title}</span>
          </div>
          {subtitle && (
            <div
              style={{
                marginTop: 2,
                fontSize: 11,
                color: 'var(--cm-text-muted, #8b949e)',
              }}
            >
              {subtitle}
            </div>
          )}
        </div>
        <div style={{ padding: 12 }}>{children}</div>
        <div
          style={{
            padding: '6px 16px',
            borderTop: '1px solid var(--cm-border, #30363d)',
            fontSize: 11,
            color: 'var(--cm-text-muted, #8b949e)',
            display: 'flex',
            justifyContent: 'space-between',
          }}
        >
          <span>↑↓ navigate · ⏎ select · esc close</span>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--cm-text-muted, #8b949e)',
              fontFamily: 'inherit',
              fontSize: 11,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            close
          </button>
        </div>
      </div>
    </div>
  );
};

export default SlashCommandModal;
