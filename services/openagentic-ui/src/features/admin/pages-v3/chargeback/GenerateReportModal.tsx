import * as React from 'react'
import {
  Modal,
  v3InputStyle,
  Btn,
  Banner,
  FormGrid,
  FormRow,
} from '../../primitives-v3'

export interface GenerateReportPayload {
  report_period: string
  group_id?: string
  user_id?: string
  cost_center?: string
}

export interface GenerateReportModalProps {
  open: boolean
  onClose: () => void
  onSubmit: (payload: GenerateReportPayload) => Promise<void>
  isSubmitting: boolean
  error?: string | null
}

function defaultPeriod(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export const GenerateReportModal: React.FC<GenerateReportModalProps> = ({
  open,
  onClose,
  onSubmit,
  isSubmitting,
  error,
}) => {
  const [period, setPeriod] = React.useState(defaultPeriod())
  const [groupId, setGroupId] = React.useState('')
  const [userId, setUserId] = React.useState('')
  const [costCenter, setCostCenter] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setPeriod(defaultPeriod())
      setGroupId('')
      setUserId('')
      setCostCenter('')
    }
  }, [open])

  const valid = /^\d{4}-\d{2}$/.test(period.trim())

  const submit = () => {
    void onSubmit({
      report_period: period.trim(),
      group_id: groupId.trim() || undefined,
      user_id: userId.trim() || undefined,
      cost_center: costCenter.trim() || undefined,
    })
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Generate chargeback report"
      width={520}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={isSubmitting}>
            cancel
          </Btn>
          <Btn variant="primary" disabled={!valid || isSubmitting} onClick={submit}>
            {isSubmitting ? 'generating…' : 'generate'}
          </Btn>
        </>
      }
    >
      {error && (
        <Banner level="err" label="error">
          {error}
        </Banner>
      )}
      <FormGrid>
        <FormRow name="report period" desc="YYYY-MM">
          <input
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder="2026-05"
            style={v3InputStyle}
          />
        </FormRow>
        <FormRow name="group id" desc="optional — scope to a single group">
          <input value={groupId} onChange={(e) => setGroupId(e.target.value)} style={v3InputStyle} />
        </FormRow>
        <FormRow name="user id" desc="optional — scope to a single user">
          <input value={userId} onChange={(e) => setUserId(e.target.value)} style={v3InputStyle} />
        </FormRow>
        <FormRow name="cost center" desc="optional tag passed through to the report metadata">
          <input
            value={costCenter}
            onChange={(e) => setCostCenter(e.target.value)}
            style={v3InputStyle}
          />
        </FormRow>
      </FormGrid>
    </Modal>
  )
}

export default GenerateReportModal
