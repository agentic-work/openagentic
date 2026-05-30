import * as React from 'react'
import './styles.css'

export interface FormRowProps {
  name: string
  desc?: React.ReactNode
  configKey?: string
  children: React.ReactNode
  status?: React.ReactNode
}

export const FormRow = ({ name, desc, configKey, children, status }: FormRowProps) => (
  <div className="aw-form-row">
    <div className="lbl">
      <div className="lbl-name">{name}</div>
      {desc && <div className="lbl-desc">{desc}</div>}
      {configKey && (
        <span
          style={{
            fontFamily: 'var(--font-v3-mono)',
            fontSize: 9,
            color: 'var(--fg-3)',
            background: 'var(--bg-2)',
            border: '1px solid var(--line-1)',
            padding: '1px 4px',
            alignSelf: 'flex-start',
            marginTop: 2,
          }}
        >
          {configKey}
        </span>
      )}
    </div>
    <div className="ctl">{children}</div>
    <div className="stat">{status ?? ''}</div>
  </div>
)

export const FormGrid = ({ children }: { children: React.ReactNode }) => (
  <div className="aw-form-grid">{children}</div>
)

// Convenience labels
export const SavedTag = () => <span style={{ color: 'var(--ok)' }}>saved</span>
export const DirtyTag = () => <span style={{ color: 'var(--warn)' }}>unsaved</span>
export const LockedTag = () => <span style={{ color: 'var(--fg-3)' }}>locked</span>
