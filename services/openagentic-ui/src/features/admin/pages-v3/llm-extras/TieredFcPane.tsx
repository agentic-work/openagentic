import * as React from 'react'
import {
  Banner,
  SectionBar,
  Btn,
} from '../../primitives-v3'

export const TieredFcPane: React.FC = () => {
  return (
    <>
      <Banner level="warn" label="deprecated">
        <span>
          Tiered Function Calling was replaced by{' '}
          <span className="accent">SmartModelRouter FCA scoring</span> in May 2026
          (task #622). The previous cheap / balanced / premium tier model selectors
          had no effect on routing — writes to this config were silently ignored by
          the live chat pipeline. Use{' '}
          <span className="accent">Router Tuning</span> instead.
        </span>
      </Banner>

      <SectionBar
        title="where the old settings live now"
        right={<span style={{ color: 'var(--fg-3)' }}>read-only navigation</span>}
      />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '180px 1fr auto',
          gap: 14,
          alignItems: 'center',
          padding: '10px 14px',
          border: '1px solid var(--line-1)',
        }}
      >
        <div style={{ color: 'var(--fg-1)', fontFamily: 'var(--font-v3-mono)', fontSize: 12 }}>
          FCA floor knobs
        </div>
        <div style={{ color: 'var(--fg-2)', fontSize: 12 }}>
          fcaQualityFloor · fcaSimpleToolFloor · fcaComplexToolFloor · fcaDestructiveFloor
          (was: cheap / balanced / premium tier model selectors)
        </div>
        <Btn
          variant="ghost"
          onClick={() => {
            if (typeof window !== 'undefined') {
              window.location.hash = '#router-tuning'
            }
          }}
        >
          Router Tuning →
        </Btn>
      </div>

      <Banner level="info" label="why">
        The V2 chat pipeline routes via FCA scoring (Function Calling Ability score
        per the model registry) — not tier buckets. SmartModelRouter selects the
        highest-FCA-scoring model whose capability set covers the tool array for the
        current turn. There is no &quot;cheap tier&quot; or &quot;premium tier&quot;
        concept in the live pipeline. The{' '}
        <span className="accent">TieredFunctionCallingService</span> singleton still
        exists but its <span className="accent">makeDecision()</span> is called only
        from the admin config test endpoint — zero chat pipeline call sites.
      </Banner>
    </>
  )
}
