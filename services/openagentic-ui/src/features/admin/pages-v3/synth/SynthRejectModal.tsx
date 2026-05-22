import * as React from 'react'
import { Modal, v3InputStyle, v3TextareaStyle, Btn, Banner } from '../../primitives-v3'

export interface SynthRejectModalProps {
  open: boolean
  approvalId: string | null
  onClose: () => void
  onSubmit: (reason: string) => Promise<void> | void
  isSubmitting: boolean
  error?: string | null
}

export const SynthRejectModal: React.FC<SynthRejectModalProps> = ({
  open,
  approvalId,
  onClose,
  onSubmit,
  isSubmitting,
  error,
}) => {
  const [reason, setReason] = React.useState('')
  React.useEffect(() => {
    if (!open) setReason('')
  }, [open])

  const valid = reason.trim().length >= 3

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Reject ${approvalId?.slice(0, 8) ?? ''}`}
      width={520}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={isSubmitting}>
            cancel
          </Btn>
          <Btn
            variant="primary"
            disabled={!valid || isSubmitting}
            onClick={() => void onSubmit(reason.trim())}
          >
            {isSubmitting ? 'rejecting…' : 'reject'}
          </Btn>
        </>
      }
    >
      {error && (
        <Banner level="err" label="error">
          {error}
        </Banner>
      )}
      <div style={{ display: 'grid', gap: 12 }}>
        <label style={{ display: 'block', fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
          Reason (required, min 3 chars)
          <textarea
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="why is this synth being rejected?"
            style={{ ...v3TextareaStyle, marginTop: 4 }}
          />
        </label>
        <div style={{ fontSize: 11, color: 'var(--fg-3)', fontFamily: 'var(--font-v3-mono)' }}>
          The reason is broadcast to the requesting user via the synth approval SSE stream
          and audited.
        </div>
      </div>
    </Modal>
  )
}

export default SynthRejectModal

// Used as fallback for input width parity with form rows.
void v3InputStyle
