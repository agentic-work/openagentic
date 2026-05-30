import * as React from 'react'
import { Btn, Banner } from '../../primitives-v3'

export interface ConfirmInlineProps {
  label: React.ReactNode
  /** Defaults to "delete". */
  confirmLabel?: string
  /** Defaults to "cancel". */
  cancelLabel?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  level?: 'warn' | 'err'
}

export const ConfirmInline: React.FC<ConfirmInlineProps> = ({
  label,
  confirmLabel = 'delete',
  cancelLabel = 'cancel',
  busy = false,
  onConfirm,
  onCancel,
  level = 'warn',
}) => (
  <Banner level={level} label="confirm">
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <span>{label}</span>
      <Btn
        variant="primary"
        onClick={onConfirm}
        disabled={busy}
        style={{ marginLeft: 8 }}
      >
        {busy ? '…' : confirmLabel}
      </Btn>
      <Btn variant="ghost" onClick={onCancel} disabled={busy}>
        {cancelLabel}
      </Btn>
    </span>
  </Banner>
)

export default ConfirmInline
