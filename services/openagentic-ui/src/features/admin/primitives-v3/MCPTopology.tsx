import * as React from 'react'

export interface MCPNode {
  id: string
  name: string
  tools: number
  callsPerHour: number
  status: 'ok' | 'warn' | 'err' | 'idle'
  tier?: 't1' | 't2' | 't3'
}

export interface MCPTopologyProps {
  nodes: MCPNode[]
  width?: number
  height?: number
  hubLabel?: string
  hubSubLabel?: string
  onSelect?: (node: MCPNode) => void
  selectedId?: string
}

export const MCPTopology = ({
  nodes,
  width = 520,
  height = 380,
  hubLabel = 'mcp-proxy',
  hubSubLabel,
  onSelect,
  selectedId,
}: MCPTopologyProps) => {
  const [hoverId, setHoverId] = React.useState<string | null>(null)

  // Layout: ring of nodes around a central hub
  const cx = width / 2
  const cy = height / 2
  const minR = 110
  const maxR = Math.min(width, height) / 2 - 36

  // Tool-count → spoke length scale (clamped)
  const maxTools = Math.max(1, ...nodes.map((n) => n.tools))
  const spokeR = (tools: number) => minR + (tools / maxTools) * (maxR - minR)

  // Calls/h → dot radius scale
  const maxCalls = Math.max(1, ...nodes.map((n) => n.callsPerHour))
  const dotR = (calls: number) => 6 + (calls / maxCalls) * 14

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: 'block' }}
      aria-label="MCP server topology"
    >
      {/* concentric guide rings */}
      <g fill="none" stroke="var(--line-1)" strokeWidth={0.5}>
        <circle cx={cx} cy={cy} r={minR} />
        <circle cx={cx} cy={cy} r={(minR + maxR) / 2} />
        <circle cx={cx} cy={cy} r={maxR} />
      </g>

      {/* spokes */}
      {nodes.map((n, i) => {
        const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2
        const r = spokeR(n.tools)
        const x = cx + Math.cos(angle) * r
        const y = cy + Math.sin(angle) * r
        const sel = n.id === selectedId
        const hov = n.id === hoverId
        const stroke = sel ? 'var(--accent)' : hov ? 'var(--accent-line)' : 'var(--line-2)'
        const strokeWidth = sel ? 1.5 : 0.8
        return (
          <line
            key={`spoke-${n.id}`}
            x1={cx}
            y1={cy}
            x2={x}
            y2={y}
            stroke={stroke}
            strokeWidth={strokeWidth}
            opacity={hov || sel ? 1 : 0.55}
          />
        )
      })}

      {/* nodes */}
      {nodes.map((n, i) => {
        const angle = (i / nodes.length) * Math.PI * 2 - Math.PI / 2
        const r = spokeR(n.tools)
        const x = cx + Math.cos(angle) * r
        const y = cy + Math.sin(angle) * r
        const dr = dotR(n.callsPerHour)
        const sel = n.id === selectedId
        const hov = n.id === hoverId
        const fill = `var(--${n.status === 'idle' ? 'fg-3' : n.status === 'ok' ? 'ok' : n.status})`
        // Label-anchor: align outwards
        const labelAnchor = Math.cos(angle) > 0.3 ? 'start' : Math.cos(angle) < -0.3 ? 'end' : 'middle'
        const labelDx = Math.cos(angle) * (dr + 10)
        const labelDy = Math.sin(angle) * (dr + 10) + 4
        return (
          <g
            key={n.id}
            style={{ cursor: onSelect ? 'pointer' : 'default' }}
            onMouseEnter={() => setHoverId(n.id)}
            onMouseLeave={() => setHoverId(null)}
            onClick={() => onSelect?.(n)}
            onDoubleClick={() => onSelect?.(n)}
          >
            {/* hover halo */}
            {(hov || sel) && (
              <circle
                cx={x}
                cy={y}
                r={dr + 6}
                fill={fill}
                opacity={0.18}
              />
            )}
            <circle
              cx={x}
              cy={y}
              r={dr}
              fill={fill}
              stroke={sel ? 'var(--accent)' : 'var(--bg-0)'}
              strokeWidth={sel ? 2 : 1}
              opacity={n.status === 'idle' ? 0.6 : 1}
            />
            {/* tool count inside dot if dot is big enough */}
            {dr >= 12 && (
              <text
                x={x}
                y={y + 3}
                textAnchor="middle"
                fontFamily="var(--font-v3-mono)"
                fontSize={9}
                fill={n.status === 'idle' ? 'var(--fg-2)' : '#000'}
                fontWeight={600}
                style={{ pointerEvents: 'none' }}
              >
                {n.tools}
              </text>
            )}
            {/* Always-on label (server name) outside the node */}
            <text
              x={x + labelDx}
              y={y + labelDy}
              textAnchor={labelAnchor}
              fontFamily="var(--font-v3-mono)"
              fontSize={10}
              fill={hov || sel ? 'var(--fg-0)' : 'var(--fg-1)'}
              style={{ pointerEvents: 'none' }}
            >
              {n.name}
            </text>
            {/* Calls/h sub-label below name when hovered */}
            {(hov || sel) && (
              <text
                x={x + labelDx}
                y={y + labelDy + 12}
                textAnchor={labelAnchor}
                fontFamily="var(--font-v3-mono)"
                fontSize={9}
                fill="var(--accent)"
                style={{ pointerEvents: 'none' }}
              >
                {n.tools} tools · {n.callsPerHour} calls/h
              </text>
            )}
          </g>
        )
      })}

      {/* central hub */}
      <g>
        <circle
          cx={cx}
          cy={cy}
          r={48}
          fill="var(--bg-2)"
          stroke="var(--accent-line)"
          strokeWidth={1}
        />
        <circle
          cx={cx}
          cy={cy}
          r={32}
          fill="var(--bg-1)"
          stroke="var(--accent)"
          strokeWidth={1}
        />
        <text
          x={cx}
          y={cy - 2}
          textAnchor="middle"
          fontFamily="var(--font-v3-mono)"
          fontSize={11}
          fill="var(--fg-0)"
          fontWeight={500}
        >
          {hubLabel}
        </text>
        {hubSubLabel && (
          <text
            x={cx}
            y={cy + 12}
            textAnchor="middle"
            fontFamily="var(--font-v3-mono)"
            fontSize={9}
            fill="var(--accent)"
          >
            {hubSubLabel}
          </text>
        )}
      </g>

      {/* legend */}
      <g
        transform={`translate(${width - 130} ${height - 50})`}
        fontFamily="var(--font-v3-mono)"
        fontSize={9}
        fill="var(--fg-3)"
      >
        <text x={0} y={0} style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          spoke length = tool count
        </text>
        <text x={0} y={12} style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          dot size = calls / hour
        </text>
        <text x={0} y={24} style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          color = status
        </text>
      </g>
    </svg>
  )
}
