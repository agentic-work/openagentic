import * as React from 'react'
import './styles.css'
import type { Status } from './atoms'

export interface FeedRowProps {
  ts: string
  status?: Status
  who?: React.ReactNode
  act: React.ReactNode
  right?: React.ReactNode
  fresh?: boolean
}

export const FeedRow = ({ ts, status = 'idle', who, act, right, fresh }: FeedRowProps) => (
  <div className="aw-feed-row" data-fresh={fresh || undefined}>
    <span className="ts">{ts}</span>
    <span className={`aw-dot aw-dot--${status}`} />
    <span className="act">
      {who && <span className="who">{who} · </span>}
      {act}
    </span>
    {right && <span className="right">{right}</span>}
  </div>
)

export const Feed = ({ children }: { children: React.ReactNode }) => (
  <div className="aw-feed">{children}</div>
)
