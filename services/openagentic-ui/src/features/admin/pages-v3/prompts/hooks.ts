import { useAdminQuery } from '../../hooks/useAdminQuery'

/** Wire shape from /api/admin/prompts/effectiveness. */
export interface EffectivenessWire {
  totalModules: number
  enabledModules: number
  averageTokenCost: number
  totalTokenBudgetUsed: number
  moduleUsage: Array<{
    moduleName: string
    usageCount: number
    positiveCount: number
    negativeCount: number
    averageTokenCost?: number
  }>
  recentCompositions: number
  positiveOutcomes: number
  negativeOutcomes: number
  pendingOutcomes: number
}

export function useEffectiveness() {
  const q = useAdminQuery<EffectivenessWire>(
    ['prompts', 'effectiveness'],
    '/api/admin/prompts/effectiveness',
    { staleTime: 60_000 },
  )
  return {
    data: q.data ?? null,
    isLoading: q.isLoading,
    isError: q.isError,
    refetch: q.refetch,
  }
}
