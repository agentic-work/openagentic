/**
 * SedimentaryComposerPanel — animated visualization of how the composable
 * prompt system actually composes a system prompt for the LLM.
 *
 * Visual metaphor: rock strata. Bedrock = identity. Always-on core layers
 * stack above. Mode / capability / domain layers settle on top only when
 * their `injection` rule matches the user's request. Cycles through four
 * example prompts so the reader can see the gating change turn-by-turn.
 *
 * Earthen palette (deliberately not pastel) — sedimentary rock bands.
 * Lives in the docs page so admins can read it alongside the Prompt
 * Assembly Pipeline diagram.
 */

import React, { useEffect, useMemo, useState } from 'react';

interface SeedModule {
  name: string;
  cat: 'core' | 'mode' | 'capability' | 'domain';
  prio: number;
  snippet: string;
  always?: boolean;
  excludesIntent?: string[];
  requiresMode?: string[];
  requiresCapability?: string[];
  requiresIntent?: string[];
}

const MODULES: SeedModule[] = [
  { name: 'continuation',          cat: 'core',       prio: 99, snippet: 'Keep working through the request — chain tool calls until the ask is answered.', always: true },
  { name: 'safety',                cat: 'core',       prio: 98, snippet: "Ground every claim in tool results from this conversation. Don't fabricate.", always: true },
  { name: 'response-style',        cat: 'core',       prio: 97, snippet: 'Concise, professional. Markdown structure: headers, code blocks, tables.', always: true },
  { name: 'artifact-inhibitor',    cat: 'core',       prio: 96, snippet: "User didn't ask for a chart — answer in plain text and tables.", always: true, excludesIntent: ['visualization'] },
  { name: 'follow-up-suggestions', cat: 'core',       prio: 95, snippet: 'Answer exactly what was asked. End with one short follow-up question.', always: true },
  { name: 'chat-mode',             cat: 'mode',       prio: 90, snippet: 'For direct asks call the most specific native tool. Reach for delegate_to_agents only when the user asks for orchestration.', requiresMode: ['chat'] },
  { name: 'thinking-guidance',     cat: 'capability', prio: 85, snippet: 'Use extended thinking for complex problems. Plan first, execute second.', requiresCapability: ['thinking'] },
  { name: 'react-reasoning',       cat: 'capability', prio: 84, snippet: 'THINK → ACT → OBSERVE → REFLECT for tool-using tasks.', requiresCapability: ['tools'] },
  { name: 'tool-calling-strategy', cat: 'capability', prio: 80, snippet: 'Prefer the most specific tool. Run independent calls in parallel.', requiresCapability: ['tools'] },
  { name: 'long-form-writing',     cat: 'domain',     prio: 80, snippet: 'Multi-page work — emit a single artifact:markdown document.', requiresIntent: ['long-form-writing'] },
  { name: 'artifact-creation',     cat: 'domain',     prio: 75, snippet: 'Render a visual artifact. Chart.js / Plotly / D3 from same-origin runtime.', requiresIntent: ['visualization'] },
];

interface Example {
  label: string;
  text: string;
  intents: { mode: 'chat'; visualization: boolean; 'long-form'?: boolean; thinking: boolean; tools: boolean };
  response: string;
  followup: string;
}

const EXAMPLES: Example[] = [
  {
    label: 'plain Azure ask',
    text:  'show me my azure subscriptions and resource groups',
    intents: { mode: 'chat', visualization: false, thinking: true, tools: true },
    response: 'Here are your subscriptions and resource groups:\n\n• Azure subscription 1 — 0 RGs\n• openagentic-dev — 5 RGs',
    followup: 'Want me to break this down by region, or pull the cost view next?',
  },
  {
    label: 'visualization ask',
    text:  'build me a sankey of my cloud costs by service',
    intents: { mode: 'chat', visualization: true, thinking: true, tools: true },
    response: 'Pulling cost data from Azure Cost Management… rendering Sankey artifact.',
    followup: 'Want the same view scoped to last 7 days, or grouped by tag?',
  },
  {
    label: 'long-form scholarly',
    text:  'write a 2000-word whitepaper on prompt-module composition',
    intents: { mode: 'chat', visualization: false, 'long-form': true, thinking: true, tools: false },
    response: 'Drafting whitepaper as artifact:markdown — Abstract, Background, Composition Algorithm, Results, Conclusion…',
    followup: 'Want a tighter executive-summary version alongside, or to add citations?',
  },
];

// Earthen sedimentary rock palette — deliberately not pastel.
const COLOR_BY_NAME: Record<string, string> = {
  'continuation':          '#5d5040',
  'safety':                '#6d5d48',
  'response-style':        '#7a6a52',
  'artifact-inhibitor':    '#8a7558',
  'follow-up-suggestions': '#998060',
  'chat-mode':             '#a88a64',
  'thinking-guidance':     '#b6926a',
  'react-reasoning':       '#a47855',
  'tool-calling-strategy': '#8e5d3f',
  'long-form-writing':     '#7a4a30',
  'artifact-creation':     '#6e3a26',
};

const CAT_DOT: Record<string, string> = {
  core: '#c8a878', mode: '#9e7a4e', capability: '#b8843a', domain: '#7a4326',
};

function selectModulesFor(ex: Example): Array<SeedModule & { dropped: boolean }> {
  const out: Array<SeedModule & { dropped: boolean }> = [];
  for (const m of MODULES) {
    if (m.always) {
      if (m.excludesIntent && m.excludesIntent.includes('visualization') && ex.intents.visualization) {
        out.push({ ...m, dropped: true });
        continue;
      }
      out.push({ ...m, dropped: false });
      continue;
    }
    if (m.requiresMode && !m.requiresMode.includes(ex.intents.mode)) continue;
    if (m.requiresCapability) {
      const ok = m.requiresCapability.some((c) => (ex.intents as any)[c]);
      if (!ok) continue;
    }
    if (m.requiresIntent) {
      const intentKey = m.requiresIntent[0];
      if (!(ex.intents as any)[intentKey]) continue;
    }
    out.push({ ...m, dropped: false });
  }
  return out.sort((a, b) => a.prio - b.prio);
}

export const SedimentaryComposerPanel: React.FC = () => {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % EXAMPLES.length), 8000);
    return () => clearInterval(t);
  }, [paused]);

  const ex = EXAMPLES[idx];
  const modules = useMemo(() => selectModulesFor(ex), [ex]);
  const activeCount = modules.filter((m) => !m.dropped).length;

  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        borderRadius: 12,
        padding: 20,
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 280px) 1fr',
        gap: 16,
        marginTop: 16,
      }}
    >
      {/* LEFT: example prompt + intent tags */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ fontSize: 11, color: 'var(--color-textMuted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>User input</div>
        <div
          style={{
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            fontSize: 13,
            lineHeight: 1.5,
            color: 'var(--color-text)',
            background: 'var(--color-surfaceSecondary)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            padding: 12,
            minHeight: 64,
          }}
        >
          {ex.text}
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
          <Tag label={`mode: ${ex.intents.mode}`} on />
          <Tag label="intent: visualization" on={ex.intents.visualization} off={!ex.intents.visualization} />
          <Tag label="intent: long-form" on={!!ex.intents['long-form']} />
          <Tag label="cap: thinking" on={ex.intents.thinking} />
          <Tag label="cap: tools" on={ex.intents.tools} />
        </div>

        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-textMuted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Cycle ({paused ? 'paused' : 'auto'})
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
          {EXAMPLES.map((e, i) => (
            <li
              key={i}
              onClick={() => { setPaused(true); setIdx(i); }}
              style={{
                padding: '6px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                background: i === idx ? 'rgba(168, 138, 100, 0.15)' : 'transparent',
                color: i === idx ? 'var(--color-text)' : 'var(--color-textMuted)',
              }}
            >
              {e.label}
            </li>
          ))}
        </ul>
      </div>

      {/* RIGHT: sediment stack + composed readout */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div style={{ fontSize: 11, color: 'var(--color-textMuted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Composed prompt — strata view
          </div>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, color: 'var(--color-text)' }}>
            {activeCount} modules active
          </div>
        </div>

        {/* Strata stack — column-reverse so new layers settle on top visually */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column-reverse',
            background: 'linear-gradient(180deg, rgba(168,138,100,0.04), transparent 70%)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            overflow: 'hidden',
            minHeight: 360,
          }}
        >
          {modules.map((m, i) => (
            <Layer key={`${idx}-${m.name}`} m={m} index={i} />
          ))}
          <Bedrock />
        </div>

        {/* LLM response preview */}
        <div
          style={{
            fontSize: 12,
            color: 'var(--color-textSecondary)',
            background: 'var(--color-surfaceSecondary)',
            border: '1px solid var(--color-border)',
            borderRadius: 8,
            padding: 12,
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontSize: 11, color: 'var(--color-textMuted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
            LLM response
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{ex.response}</div>
          <div
            style={{
              marginTop: 8,
              paddingLeft: 10,
              borderLeft: '2px solid #b8843a',
              fontStyle: 'italic',
              color: 'var(--color-text)',
            }}
          >
            — {ex.followup}
          </div>
        </div>
      </div>
    </div>
  );
};

const Tag: React.FC<{ label: string; on?: boolean; off?: boolean }> = ({ label, on, off }) => (
  <span
    style={{
      padding: '3px 7px',
      borderRadius: 4,
      border: '1px solid ' + (on ? '#b8843a' : off ? '#a64a3a' : 'var(--color-border)'),
      background: on ? 'rgba(184,132,58,0.18)' : off ? 'rgba(166,74,58,0.12)' : 'var(--color-surfaceSecondary)',
      color: on ? '#d8a060' : off ? '#d97a6a' : 'var(--color-textMuted)',
    }}
  >
    {label}
  </span>
);

const Bedrock: React.FC = () => (
  <div
    style={{
      height: 28,
      padding: '0 14px',
      background:
        'repeating-linear-gradient(135deg, rgba(0,0,0,0.45) 0 6px, rgba(0,0,0,0.18) 6px 12px), #4a3a2c',
      borderTop: '1px solid rgba(255,255,255,0.08)',
      display: 'flex',
      alignItems: 'center',
      fontFamily: 'ui-monospace, monospace',
      fontSize: 10,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: 'rgba(255,255,255,0.55)',
    }}
  >
    bedrock — identity (admin / default)
  </div>
);

const Layer: React.FC<{ m: SeedModule & { dropped: boolean }; index: number }> = ({ m, index }) => {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 80 + index * 90);
    return () => clearTimeout(t);
  }, [index]);

  const height = 38 + Math.min(18, Math.max(0, (m.prio - 75) * 0.7));

  return (
    <div
      style={{
        height: mounted ? `${height}px` : 0,
        opacity: mounted ? (m.dropped ? 0.22 : 1) : 0,
        transform: mounted ? 'translateY(0)' : 'translateY(-10px)',
        filter: m.dropped ? 'grayscale(0.7)' : 'none',
        transition: 'height 480ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 320ms, transform 480ms cubic-bezier(0.2, 0.8, 0.2, 1)',
        background:
          'repeating-linear-gradient(180deg, rgba(255,255,255,0.04) 0 2px, transparent 2px 6px), ' +
          (COLOR_BY_NAME[m.name] || '#7a6a52'),
        borderTop: '1px solid rgba(255,255,255,0.06)',
        borderBottom: '1px solid rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 14px',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        fontSize: 12,
        color: 'rgba(255,255,255,0.92)',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: CAT_DOT[m.cat] || '#999',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.18)',
          flex: '0 0 auto',
        }}
      />
      <span style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.02em' }}>
        {m.name}
      </span>
      <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 3, background: 'rgba(0,0,0,0.25)', flex: '0 0 auto' }}>
        prio {m.prio}
      </span>
      <span style={{ flex: 1, color: 'rgba(255,255,255,0.78)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {m.snippet}
      </span>
    </div>
  );
};

export default SedimentaryComposerPanel;
