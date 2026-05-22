import * as React from 'react'
import {
  Banner,
  Btn,
  Chip,
  FormGrid,
  FormRow,
  SidePanel,
} from '../../primitives-v3'
import { useAdminMutation } from '../../hooks/useAdminQuery'

interface AddRuleModalProps {
  open: boolean
  onClose: () => void
}

interface AddExemptionBody {
  toolPattern: string
  scanPoint: 'request' | 'response' | 'both'
  exemptCategories: string[]
  reason: string
}

// Categories pulled from DLPScannerService rule definitions (2026-04).
// If the back-end adds a category, surface a banner the next time
// /api/admin/dlp/rules returns one we don't recognize.
const CATEGORIES = [
  'pii',
  'pci',
  'phi',
  'secret',
  'credential',
  'api_key',
  'database_uri',
  'private_key',
] as const

const SCAN_POINTS: Array<AddExemptionBody['scanPoint']> = ['request', 'response', 'both']

export const AddRuleModal: React.FC<AddRuleModalProps> = ({ open, onClose }) => {
  const save = useAdminMutation<{ exemption: any }, AddExemptionBody>(
    '/api/admin/dlp/exemptions',
    {
      method: 'POST',
      invalidateKeys: [['dlp']],
    },
  )

  const [toolPattern, setToolPattern] = React.useState('')
  const [scanPoint, setScanPoint] = React.useState<AddExemptionBody['scanPoint']>('both')
  const [exemptCats, setExemptCats] = React.useState<string[]>([])
  const [reason, setReason] = React.useState('')
  const [touched, setTouched] = React.useState(false)

  React.useEffect(() => {
    if (open) {
      setToolPattern('')
      setScanPoint('both')
      setExemptCats([])
      setReason('')
      setTouched(false)
      save.reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const valid = toolPattern.trim().length > 0 && exemptCats.length > 0
  const canSubmit = valid && !save.isPending

  const toggleCat = (cat: string) => {
    setExemptCats((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    )
  }

  const submit = (e?: React.FormEvent) => {
    e?.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    save.mutate(
      {
        toolPattern: toolPattern.trim(),
        scanPoint,
        exemptCategories: exemptCats,
        reason: reason.trim() || '(no reason given)',
      },
      { onSuccess: () => onClose() },
    )
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="add dlp exemption"
      meta="POST /api/admin/dlp/exemptions"
    >
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {save.isError && (
          <Banner level="err" label="error">
            {save.error?.message ?? 'failed to add exemption'}
          </Banner>
        )}
        <Banner level="info" label="how this works">
          exemptions skip selected DLP categories for tools matching
          <span className="accent"> toolPattern</span>. Use globs like
          <span className="mono"> aws_*</span> or full names like
          <span className="mono"> get_secret</span>.
        </Banner>

        <FormGrid>
          <FormRow
            name="Tool pattern"
            desc="Glob or exact tool name. Required."
            configKey="dlp.exemptions.toolPattern"
          >
            <input
              className="aw-input"
              type="text"
              value={toolPattern}
              onChange={(e) => setToolPattern(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="aws_* / get_secret / *_token"
              aria-invalid={touched && !toolPattern.trim()}
              required
            />
          </FormRow>
          <FormRow name="Scan point" desc="Which side of the tool call to skip.">
            <select
              className="aw-input"
              value={scanPoint}
              onChange={(e) => setScanPoint(e.target.value as AddExemptionBody['scanPoint'])}
            >
              {SCAN_POINTS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </FormRow>
          <FormRow
            name="Exempt categories"
            desc="Select one or more categories to suppress. Required."
            configKey="dlp.exemptions.exemptCategories"
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {CATEGORIES.map((c) => (
                <Chip
                  key={c}
                  value={c}
                  on={exemptCats.includes(c)}
                  onClick={() => toggleCat(c)}
                />
              ))}
            </div>
            {touched && exemptCats.length === 0 && (
              <div style={{
                marginTop: 4,
                fontFamily: 'var(--font-v3-mono)',
                fontSize: 'var(--v3-t-meta)',
                color: 'var(--err)',
              }}>
                pick at least one category
              </div>
            )}
          </FormRow>
          <FormRow name="Reason" desc="Audit-log justification.">
            <textarea
              className="aw-input"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="why this tool is exempt"
            />
          </FormRow>
        </FormGrid>

        <div style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 6,
          paddingTop: 6,
          borderTop: '1px solid var(--line-1)',
        }}>
          <Btn variant="ghost" type="button" onClick={onClose}>cancel</Btn>
          <Btn variant="primary" type="submit" disabled={!canSubmit} onClick={() => submit()}>
            {save.isPending ? 'adding…' : 'add exemption'}
          </Btn>
        </div>
      </form>
    </SidePanel>
  )
}

export default AddRuleModal
