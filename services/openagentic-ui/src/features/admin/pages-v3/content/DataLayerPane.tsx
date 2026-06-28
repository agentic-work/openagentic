import * as React from 'react'
import {
  Panel,
  PanelHead,
  Dt,
  type DtCol,
  EmptyInline,
  StatusDot,
  Banner,
  MiniGrid,
  Mini,
  SectionBar,
} from '../../primitives-v3'
import {
  type RedisMetrics,
  type MilvusMetrics,
  type VectorUsageRow,
  fmtBytes,
  fmtNum,
} from './hooks'

interface MilvusCollectionRow {
  name: string
  rowCount: number
  dimension?: number
  indexType?: string
}

export interface DataLayerPaneProps {
  redis?: RedisMetrics
  redisLoading: boolean
  redisError: boolean
  milvus?: MilvusMetrics
  milvusLoading: boolean
  milvusError: boolean
  vectorUsage?: VectorUsageRow
  vectorUsageLoading: boolean
  vectorUsageError: boolean
}

export const DataLayerPane: React.FC<DataLayerPaneProps> = ({
  redis,
  redisLoading,
  redisError,
  milvus,
  milvusLoading,
  milvusError,
  vectorUsage,
  vectorUsageLoading,
  vectorUsageError,
}) => {
  const collections: MilvusCollectionRow[] = vectorUsage?.milvusCollections ?? []

  const cols: DtCol<MilvusCollectionRow>[] = [
    {
      key: 'name',
      label: 'COLLECTION',
      className: 'mono',
      render: (r) => <span style={{ color: 'var(--fg-1)' }}>{r.name}</span>,
    },
    {
      key: 'rows',
      label: 'ROWS',
      className: 'num',
      render: (r) => fmtNum(r.rowCount),
    },
    {
      key: 'dim',
      label: 'DIM',
      className: 'num',
      render: (r) => (typeof r.dimension === 'number' ? r.dimension : '—'),
    },
    {
      key: 'index',
      label: 'INDEX',
      className: 'mono',
      render: (r) => r.indexType ?? '—',
    },
  ]

  const totalErr = redisError && milvusError && vectorUsageError

  return (
    <>
      {totalErr && (
        <Banner level="err" label="error">
          all three data-layer endpoints unreachable — confirm Redis / Milvus pods
        </Banner>
      )}

      <SectionBar title="caching tiers" />
      <Panel>
        <PanelHead title="L1 · Redis" count={redis?.connected === false ? 'down' : 'up'} />
        {redisError ? (
          <Banner level="err" label="error">
            failed to load <span className="accent">/api/admin/metrics/redis</span>
          </Banner>
        ) : (
          <div style={{ padding: '10px 14px' }}>
            <MiniGrid cols={4}>
              <Mini
                label="status"
                value={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <StatusDot status={redis?.connected ? 'ok' : 'err'} />
                    {redisLoading ? '…' : redis?.connected ? 'connected' : 'down'}
                  </span>
                }
                sub={redis?.version ? `v${redis.version}` : ''}
                tone={redis?.connected ? 'ok' : 'err'}
              />
              <Mini
                label="hit rate"
                value={
                  redisLoading
                    ? '…'
                    : typeof redis?.hit_rate === 'number'
                      ? `${(redis.hit_rate * 100).toFixed(1)}%`
                      : '—'
                }
                sub={`${fmtNum(redis?.hits)} hits · ${fmtNum(redis?.misses)} miss`}
                tone={
                  typeof redis?.hit_rate === 'number'
                    ? redis.hit_rate >= 0.8
                      ? 'ok'
                      : redis.hit_rate >= 0.5
                        ? 'warn'
                        : 'err'
                    : 'default'
                }
              />
              <Mini
                label="memory"
                value={redisLoading ? '…' : fmtBytes(redis?.memory?.used)}
                sub={`peak ${fmtBytes(redis?.memory?.peak)}`}
              />
              <Mini
                label="keys"
                value={redisLoading ? '…' : fmtNum(redis?.keys)}
                sub={`${fmtNum(redis?.evicted_keys)} evicted`}
              />
            </MiniGrid>
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHead
          title="L2 · pgvector"
          count={
            vectorUsage?.pgvectorTotals
              ? `${fmtNum(
                  Object.values(vectorUsage.pgvectorTotals).reduce<number>(
                    (a, b) => a + (typeof b === 'number' ? b : 0),
                    0,
                  ),
                )} rows`
              : ''
          }
        />
        {vectorUsageError ? (
          <Banner level="err" label="error">
            failed to load <span className="accent">/api/admin/metrics/vector-usage</span>
          </Banner>
        ) : (
          <div style={{ padding: '10px 14px' }}>
            <MiniGrid cols={3}>
              <Mini
                label="user memories"
                value={vectorUsageLoading ? '…' : fmtNum(vectorUsage?.pgvectorTotals?.userMemories)}
                sub="per-user RAG memory"
              />
              <Mini
                label="tool result cache"
                value={vectorUsageLoading ? '…' : fmtNum(vectorUsage?.pgvectorTotals?.toolResultCache)}
                sub="MCP-tool semantic cache"
              />
              <Mini
                label="verified results"
                value={
                  vectorUsageLoading
                    ? '…'
                    : fmtNum(vectorUsage?.pgvectorTotals?.verifiedToolResults)
                }
                sub="approved tool outputs"
              />
              <Mini
                label="success records"
                value={
                  vectorUsageLoading
                    ? '…'
                    : fmtNum(vectorUsage?.pgvectorTotals?.toolSuccessRecords)
                }
                sub="positive feedback corpus"
              />
              <Mini
                label="query embeddings"
                value={
                  vectorUsageLoading
                    ? '…'
                    : fmtNum(vectorUsage?.pgvectorTotals?.queryEmbeddingCache)
                }
                sub="user-query cache"
              />
              <Mini
                label="vector collections"
                value={
                  vectorUsageLoading
                    ? '…'
                    : fmtNum(vectorUsage?.pgvectorTotals?.userVectorCollections)
                }
                sub="user-defined corpora"
              />
            </MiniGrid>
          </div>
        )}
      </Panel>

      <Panel>
        <PanelHead
          title="L3 · Milvus"
          count={milvus?.connected === false ? 'down' : milvus?.healthy ? 'healthy' : 'up'}
        />
        {milvusError ? (
          <Banner level="err" label="error">
            failed to load <span className="accent">/api/admin/metrics/milvus</span>
          </Banner>
        ) : (
          <div style={{ padding: '10px 14px' }}>
            <MiniGrid cols={4}>
              <Mini
                label="status"
                value={
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <StatusDot status={milvus?.healthy ? 'ok' : milvus?.connected ? 'warn' : 'err'} />
                    {milvusLoading
                      ? '…'
                      : milvus?.healthy
                        ? 'healthy'
                        : milvus?.connected
                          ? 'degraded'
                          : 'down'}
                  </span>
                }
                sub={milvus?.mode ?? ''}
                tone={milvus?.healthy ? 'ok' : milvus?.connected ? 'warn' : 'err'}
              />
              <Mini
                label="collections"
                value={milvusLoading ? '…' : fmtNum(milvus?.collections)}
                sub={`${fmtNum(vectorUsage?.milvusTotalCollections)} from vector-usage`}
              />
              <Mini
                label="queries"
                value={milvusLoading ? '…' : fmtNum(milvus?.queries)}
                sub={`${typeof milvus?.latency === 'number' ? `${milvus.latency.toFixed(1)}ms` : '—'} latency`}
              />
              <Mini
                label="inserts"
                value={milvusLoading ? '…' : fmtNum(milvus?.inserts)}
                sub={milvus?.minio_connected ? 'minio · ok' : 'minio · ?'}
              />
            </MiniGrid>
          </div>
        )}
      </Panel>

      <SectionBar title="milvus collections" count={collections.length} />
      <Panel>
        <PanelHead title="collections" count={`${fmtNum(vectorUsage?.milvusTotalRows)} rows`} />
        {vectorUsageLoading ? (
          <EmptyInline pad>loading /api/admin/metrics/vector-usage…</EmptyInline>
        ) : collections.length === 0 ? (
          <EmptyInline pad>no collections returned by vector-usage</EmptyInline>
        ) : (
          <Dt columns={cols} rows={collections} rowKey={(r) => r.name} />
        )}
      </Panel>
    </>
  )
}
