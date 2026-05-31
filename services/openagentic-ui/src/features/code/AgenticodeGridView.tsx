/**
 * AgenticodeGridView — renders agenticode's OWN char-grid output as themed DOM,
 * NO terminal emulator (no xterm). agenticode's React TUI is rendered headless
 * through its own custom Ink reconciler + pure-TS Yoga into a char-grid frame;
 * this repaints that frame: cursor-forward -> cells, SGR -> styled spans.
 * Path A from the INK->React audit: 1-1 with the TUI, React-driven, zero xterm.
 */
import React from 'react'

const NAMED: Record<number, string> = {
  30:'#3b3b3b',31:'#C8401C',32:'#2E9E5B',33:'#C9821A',34:'#2F6DB3',35:'#B83A8E',36:'#2AA8B0',37:'#F4EFE6',
  90:'#7A6D5A',91:'#FF5722',92:'#5BD68B',93:'#FFB87E',94:'#7FC8FF',95:'#E07AC0',96:'#7EE0E8',97:'#FFFFFF',
}

/** agenticode char-grid ANSI frame -> styled HTML (no xterm). */
export function gridToHtml(s: string): string {
  let html = ''
  let st: { fg: string | null; bold: boolean } = { fg: null, bold: false }
  const esc = (c: string) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c)
  const open = () => {
    let css = ''
    if (st.fg) css += 'color:' + st.fg + ';'
    if (st.bold) css += 'font-weight:700;'
    return css ? '<span style="' + css + '">' : '<span>'
  }
  let span = open(); let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '\x1b') {
      if (s[i + 1] === '[') {
        let j = i + 2, params = ''
        if (s[j] === '?') { while (j < s.length && !/[a-zA-Z]/.test(s[j])) j++; i = j + 1; continue }
        while (j < s.length && !/[a-zA-Z]/.test(s[j])) { params += s[j]; j++ }
        const fin = s[j]
        if (fin === 'C') span += ' '.repeat(parseInt(params || '1', 10))
        else if (fin === 'm') {
          span += '</span>'; html += span
          const codes = params.split(';').filter((x) => x !== '').map(Number)
          if (codes.length === 0 || codes.includes(0)) st = { fg: null, bold: false }
          for (let k = 0; k < codes.length; k++) {
            const cd = codes[k]
            if (cd === 1) st.bold = true
            else if (cd === 22) st.bold = false
            else if (NAMED[cd]) st.fg = NAMED[cd]
            else if (cd === 38 && codes[k + 1] === 2) { st.fg = 'rgb(' + codes[k+2] + ',' + codes[k+3] + ',' + codes[k+4] + ')'; k += 4 }
            else if (cd === 38 && codes[k + 1] === 5) { st.fg = NAMED[codes[k + 2]] || '#F4EFE6'; k += 2 }
            else if (cd === 39) st.fg = null
          }
          span = open()
        }
        i = j + 1; continue
      } else if (s[i + 1] === ']') {
        let j = i + 2
        while (j < s.length && s[j] !== '\x07' && !(s[j] === '\x1b' && s[j + 1] === '\\')) j++
        i = s[j] === '\x07' ? j + 1 : j + 2; continue
      }
      i++; continue
    }
    if (c === '\n') { span += '\n'; i++; continue }
    if (c === '\r') { i++; continue }
    span += esc(c); i++
  }
  span += '</span>'; html += span
  return html.replace(/^\n+/, '')
}

// A real agenticode TUI frame, captured from its own headless renderer.
const SAMPLE_FRAME = atob('G1s/MjVsG1s/MjAyNmjila3ilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDila4NCuKUghtbMUPijKUbWzFDYWdlbnRpY29kZRtbNDhDZ3B0LW9zczoyMGIbWzFDwrcbWzFDfi9wcm9qG1sxQ+KUgg0K4pWw4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pWvDQoNCnlvdQ0KYWRkG1sxQ2EbWzFDL2hlYWx0aBtbMUNyb3V0ZRtbMUN0bxtbMUN0aGUbWzFDZXhwcmVzcxtbMUNhcHANCg0K4pWt4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pWuDQrilIIbWzFD4pqZG1sxQ2VkaXQbWzJDc3JjL3NlcnZlci50cxtbNTlD4pSCDQrilIIbWzFDKxtbMUNhcHAuZ2V0KCIvaGVhbHRoIiwbWzFDKF8scmVzKT0+cmVzLmpzb24oe29rOnRydWV9KSkbWzMxQ+KUgg0K4pWw4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pWvDQoNCmFnZW50aWNvZGUNCkRvbmUbWzFD4oCUG1sxQ2FkZGVkG1sxQ0dFVBtbMUMvaGVhbHRoG1sxQ3JldHVybmluZxtbMUN7b2s6dHJ1ZX0uDQoNCuKVreKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKVrg0K4pSCG1sxQ+KAuhtbMUNhc2sbWzFDYWdlbnRpY29kZeKAphtbNjRD4pSCDQrilbDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDila8NChtbPzIwMjZs')

export const AgenticodeGridView: React.FC<{ frame?: string }> = ({ frame }) => {
  const html = React.useMemo(() => gridToHtml(frame ?? SAMPLE_FRAME), [frame])
  return (
    <div style={{ width: '100%', height: '100%', background: 'var(--color-background, #18130C)', overflow: 'auto', padding: 18 }}>
      <div style={{ fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)", fontSize: 15, lineHeight: 1.32, whiteSpace: 'pre', color: 'var(--color-text, #F4EFE6)' }}
           dangerouslySetInnerHTML={{ __html: html }} />
      <div style={{ marginTop: 14, fontFamily: 'var(--font-mono, monospace)', fontSize: 11, color: 'var(--color-text-muted, #968B76)' }}>
        agenticode TUI · its own Ink reconciler + pure-TS Yoga → DOM char-grid · no xterm
      </div>
    </div>
  )
}
export default AgenticodeGridView
