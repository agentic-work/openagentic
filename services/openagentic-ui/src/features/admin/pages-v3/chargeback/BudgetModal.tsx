import * as React from 'react'
import {
  Modal,
  v3InputStyle,
  Btn,
  Banner,
  FormGrid,
  FormRow,
  Toggle,
} from '../../primitives-v3'
import type { CostBudgetRow } from './hooks'

export type BudgetType = 'user' | 'group' | 'global'
export type ActionOnLimit = 'warn' | 'throttle' | 'block'

export type BudgetModalMode = 'create' | 'edit'

export interface BudgetPayload {
  id?: string
  name: string
  budget_type: BudgetType
  user_id?: string
  group_id?: string
  monthly_limit: number
  daily_limit?: number
  weekly_limit?: number
  annual_limit?: number
  action_on_limit: ActionOnLimit
  throttle_to_model?: string
  alert_threshold_50?: boolean
  alert_threshold_75?: boolean
  alert_threshold_90?: boolean
  alert_threshold_100?: boolean
}

export interface BudgetModalProps {
  open: boolean
  mode: BudgetModalMode
  initial: CostBudgetRow | null
  onClose: () => void
  onSubmit: (payload: BudgetPayload, mode: BudgetModalMode) => Promise<void>
  isSubmitting: boolean
  error?: string | null
}

export const BudgetModal: React.FC<BudgetModalProps> = ({
  open,
  mode,
  initial,
  onClose,
  onSubmit,
  isSubmitting,
  error,
}) => {
  const [name, setName] = React.useState('')
  const [budgetType, setBudgetType] = React.useState<BudgetType>('global')
  const [targetId, setTargetId] = React.useState('')
  const [monthly, setMonthly] = React.useState('100')
  const [daily, setDaily] = React.useState('')
  const [weekly, setWeekly] = React.useState('')
  const [annual, setAnnual] = React.useState('')
  const [action, setAction] = React.useState<ActionOnLimit>('warn')
  const [throttleModel, setThrottleModel] = React.useState('')
  const [alert50, setAlert50] = React.useState(true)
  const [alert75, setAlert75] = React.useState(true)
  const [alert90, setAlert90] = React.useState(true)
  const [alert100, setAlert100] = React.useState(true)

  React.useEffect(() => {
    if (!open) return
    if (initial) {
      setName('')
      setBudgetType(initial.userId ? 'user' : initial.groupId ? 'group' : 'global')
      setTargetId(initial.userId ?? initial.groupId ?? '')
      setMonthly(String((initial.limitCents ?? 0) / 100))
      setDaily('')
      setWeekly('')
      setAnnual('')
      setAction((initial.actionOnLimit as ActionOnLimit) ?? 'warn')
      setThrottleModel(initial.throttleToModel ?? '')
      setAlert50(true)
      setAlert75(true)
      setAlert90(true)
      setAlert100(true)
    } else {
      setName('')
      setBudgetType('global')
      setTargetId('')
      setMonthly('100')
      setDaily('')
      setWeekly('')
      setAnnual('')
      setAction('warn')
      setThrottleModel('')
      setAlert50(true)
      setAlert75(true)
      setAlert90(true)
      setAlert100(true)
    }
  }, [open, initial])

  const valid =
    name.trim().length > 0 &&
    Number(monthly) > 0 &&
    (budgetType === 'global' || targetId.trim().length > 0)

  const submit = () => {
    void onSubmit(
      {
        id: mode === 'edit' ? initial?.id : undefined,
        name: name.trim(),
        budget_type: budgetType,
        user_id: budgetType === 'user' ? targetId.trim() : undefined,
        group_id: budgetType === 'group' ? targetId.trim() : undefined,
        monthly_limit: Number(monthly),
        daily_limit: daily ? Number(daily) : undefined,
        weekly_limit: weekly ? Number(weekly) : undefined,
        annual_limit: annual ? Number(annual) : undefined,
        action_on_limit: action,
        throttle_to_model: action === 'throttle' && throttleModel ? throttleModel : undefined,
        alert_threshold_50: alert50,
        alert_threshold_75: alert75,
        alert_threshold_90: alert90,
        alert_threshold_100: alert100,
      },
      mode,
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'edit' ? `Edit budget · ${initial?.id?.slice(0, 8) ?? ''}` : '+ New cost budget'}
      width={680}
      footer={
        <>
          <Btn variant="ghost" onClick={onClose} disabled={isSubmitting}>
            cancel
          </Btn>
          <Btn variant="primary" disabled={!valid || isSubmitting} onClick={submit}>
            {isSubmitting ? (mode === 'edit' ? 'saving…' : 'creating…') : mode === 'edit' ? 'save' : 'create'}
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
        <FormRow name="name">
          <input value={name} onChange={(e) => setName(e.target.value)} style={v3InputStyle} />
        </FormRow>
        <FormRow name="target type">
          <select
            value={budgetType}
            onChange={(e) => setBudgetType(e.target.value as BudgetType)}
            style={v3InputStyle}
          >
            <option value="global">global</option>
            <option value="user">user</option>
            <option value="group">group</option>
          </select>
        </FormRow>
        {budgetType !== 'global' && (
          <FormRow name={`${budgetType} id`} desc="paste the target user or group id">
            <input value={targetId} onChange={(e) => setTargetId(e.target.value)} style={v3InputStyle} />
          </FormRow>
        )}
        <FormRow name="monthly limit (USD)" desc="required">
          <input
            type="number"
            min={0.01}
            step={0.01}
            value={monthly}
            onChange={(e) => setMonthly(e.target.value)}
            style={v3InputStyle}
          />
        </FormRow>
        <FormRow name="daily limit (USD)" desc="optional">
          <input
            type="number"
            min={0}
            step={0.01}
            value={daily}
            onChange={(e) => setDaily(e.target.value)}
            style={v3InputStyle}
          />
        </FormRow>
        <FormRow name="weekly limit (USD)" desc="optional">
          <input
            type="number"
            min={0}
            step={0.01}
            value={weekly}
            onChange={(e) => setWeekly(e.target.value)}
            style={v3InputStyle}
          />
        </FormRow>
        <FormRow name="annual limit (USD)" desc="optional">
          <input
            type="number"
            min={0}
            step={0.01}
            value={annual}
            onChange={(e) => setAnnual(e.target.value)}
            style={v3InputStyle}
          />
        </FormRow>
        <FormRow name="action on limit">
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as ActionOnLimit)}
            style={v3InputStyle}
          >
            <option value="warn">warn</option>
            <option value="throttle">throttle</option>
            <option value="block">block</option>
          </select>
        </FormRow>
        {action === 'throttle' && (
          <FormRow name="throttle to model" desc="cheaper model id to fall back to">
            <input
              value={throttleModel}
              onChange={(e) => setThrottleModel(e.target.value)}
              style={v3InputStyle}
              placeholder="e.g. claude-haiku"
            />
          </FormRow>
        )}
        <FormRow name="alert at 50%">
          <Toggle on={alert50} onChange={setAlert50} />
        </FormRow>
        <FormRow name="alert at 75%">
          <Toggle on={alert75} onChange={setAlert75} />
        </FormRow>
        <FormRow name="alert at 90%">
          <Toggle on={alert90} onChange={setAlert90} />
        </FormRow>
        <FormRow name="alert at 100%">
          <Toggle on={alert100} onChange={setAlert100} />
        </FormRow>
      </FormGrid>
    </Modal>
  )
}

export default BudgetModal
