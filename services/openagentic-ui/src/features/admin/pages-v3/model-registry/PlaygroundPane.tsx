import * as React from 'react'
import { Panel, PanelHead, EmptyInline } from '../../primitives-v3'
import { PlaygroundTab } from '../../components/LLM/ModelManagementView/PlaygroundTab'
import type {
  DbProvider,
  ModelInfo,
} from '../../components/LLM/ModelManagementView/constants'
import type { LlmProviderRow } from '../../hooks/useDashboardMetrics'

interface PlaygroundPaneProps {
  providers: LlmProviderRow[] | undefined
  isLoading: boolean
}

export const PlaygroundPane: React.FC<PlaygroundPaneProps> = ({
  providers,
  isLoading,
}) => {
  // Shape-adapt v3 LlmProviderRow → v2 DbProvider + ModelInfo[].
  // The v2 PlaygroundTab walks providers/models to populate its
  // selector chips, then POSTs to /api/admin/llm-providers/:provider/test.
  const { dbProviders, dbModels } = React.useMemo(() => {
    const dbProviders: DbProvider[] = []
    const dbModels: ModelInfo[] = []
    for (const p of providers ?? []) {
      dbProviders.push({
        id: p.id,
        name: p.name,
        displayName: p.displayName ?? p.name,
        type: p.type as any,
        enabled: p.enabled,
        priority: p.priority ?? 50,
        capabilities: (p.capabilities as any) ?? { chat: true },
        config: (p.config as any) ?? {},
        authConfig: (p.authConfig as any) ?? { type: 'none' },
        models: (p.models as any) ?? [],
      } as unknown as DbProvider)
      for (const m of p.models ?? []) {
        const caps = m.capabilities ?? {}
        dbModels.push({
          id: m.id,
          name: m.name ?? m.id,
          provider: p.displayName ?? p.name,
          providerId: p.id,
          providerType: p.type,
          providerName: p.name,
          capabilities: {
            chat: caps.chat !== false,
            embeddings: caps.embeddings === true,
            tools: caps.tools === true,
            vision: caps.vision === true,
            streaming: caps.streaming === true,
          },
          maxTokens: m.maxTokens,
          enabled: p.enabled,
          costPerInputToken: m.costPerToken?.prompt,
          costPerOutputToken: m.costPerToken?.completion,
        })
      }
    }
    return { dbProviders, dbModels }
  }, [providers])

  return (
    <Panel>
      <PanelHead
        title="Playground"
        count={
          dbModels.filter((m) => m.capabilities.chat).length + ' chat models'
        }
        right={<a>POST /api/admin/llm-providers/:provider/test</a>}
      />
      {isLoading ? (
        <EmptyInline pad>loading providers…</EmptyInline>
      ) : dbProviders.length === 0 ? (
        <EmptyInline pad>
          no providers configured — go to Provider Management to add one
        </EmptyInline>
      ) : (
        <div style={{ padding: 8 }}>
          <PlaygroundTab providers={dbProviders} models={dbModels} />
        </div>
      )}
    </Panel>
  )
}
