import React, { useMemo } from 'react';

/**
 * Tiny syntax-highlighter for the INPUT/RESULT JSON blocks inside `.cm-tool .cm-t-section`.
 * Produces spans with the mock-canonical classes `.cm-k` (key), `.cm-s`
 * (string), `.cm-n` (number), `.cm-b` (bool), `.cm-c` (comment-style null),
 * matching the mock palette at mocks/UX/01-cloud-ops.html lines 350-355.
 *
 * No external dep — Shiki/highlight.js are too heavy for a 6-token JSON ribbon.
 */

interface Token {
  cls: string;
  text: string;
}

function tokenize(json: string): Token[] {
  const out: Token[] = [];
  // Match strings / numbers / booleans / null / punctuation / whitespace.
  const re = /"(?:\\.|[^"\\])*"(?:\s*:)?|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[\s,{}\[\]]+/g;
  let m: RegExpExecArray | null;
  let cursor = 0;
  while ((m = re.exec(json)) !== null) {
    if (m.index > cursor) {
      out.push({ cls: '', text: json.slice(cursor, m.index) });
    }
    const tok = m[0];
    if (tok.startsWith('"')) {
      // String — also detect "key": (with optional whitespace + colon).
      const isKey = /:\s*$/.test(tok) || /"\s*:/.test(tok);
      out.push({ cls: isKey ? 'cm-k' : 'cm-s', text: tok });
    } else if (tok === 'true' || tok === 'false') {
      out.push({ cls: 'cm-b', text: tok });
    } else if (tok === 'null') {
      out.push({ cls: 'cm-null', text: tok });
    } else if (/^-?\d/.test(tok)) {
      out.push({ cls: 'cm-n', text: tok });
    } else {
      out.push({ cls: '', text: tok });
    }
    cursor = m.index + tok.length;
  }
  if (cursor < json.length) out.push({ cls: '', text: json.slice(cursor) });
  return out;
}

export interface JsonViewProps {
  /** Anything JSON-serializable. Strings are pretty-printed with 2-space indent. */
  value: unknown;
  /** Optional override — if you already have a pretty-printed string. */
  raw?: string;
  /** Streaming caret marker on the last char (matches `.cm-tool pre.json.stream`). */
  streaming?: boolean;
}

export function JsonView({ value, raw, streaming }: JsonViewProps) {
  const text = useMemo(() => {
    if (raw !== undefined) return raw;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [raw, value]);

  const tokens = useMemo(() => tokenize(text), [text]);

  return (
    <pre className={`cm-json${streaming ? ' cm-stream' : ''}`} data-testid="json-view">
      {tokens.map((t, i) =>
        t.cls ? (
          <span key={i} className={t.cls}>
            {t.text}
          </span>
        ) : (
          <span key={i}>{t.text}</span>
        ),
      )}
    </pre>
  );
}
