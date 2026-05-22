/**
 * Heuristic: does this string contain a LaTeX command?
 * Looks for `\name` where `name` is one or more alphabetic chars,
 * OR characteristic LaTeX glyphs (`^{`, `_{`, `\\`).
 */
function looksLikeLatex(s: string): boolean {
  // \word — most commands are like \alpha, \frac, \sum, \mathbb, etc.
  if (/\\[a-zA-Z]+/.test(s)) return true;
  // Bare super/sub-scripts with braces — `x^{2}`, `a_{i,j}`.
  if (/[\^_]\{/.test(s)) return true;
  return false;
}

export function normalizeLatexDelimiters(input: string): string {
  if (!input) return input;
  let out = input;

  // 1. Explicit \( … \) → $ … $   and   \[ … \] → $$ … $$
  //    (handle multiline `\[ … \]`)
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner) => `$${inner}$`.replace(/\$\$/g, '$'));
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => `$$${inner}$$`);

  // 2. Block math: a line with ONLY `[`, content, line with ONLY `]`.
  //    Only convert if the captured body contains LaTeX-looking tokens.
  out = out.replace(
    /(^|\n)[ \t]*\[[ \t]*\n([\s\S]*?)\n[ \t]*\][ \t]*(?=\n|$)/g,
    (m, lead, body) => (looksLikeLatex(body) ? `${lead}$$\n${body}\n$$` : m),
  );

  // 3. Inline math: balanced-paren scan. Find each `(` and walk forward
  //    tracking depth so we can match `(\gcd(a,p)=1)` correctly even
  //    though the inner has its own parens. Single-line bound (cap at
  //    300 chars) keeps us from eating multi-paragraph prose if the
  //    closing paren is missing.
  out = scanAndRewriteInlineMath(out);

  return out;
}

function scanAndRewriteInlineMath(text: string): string {
  const MAX_LEN = 300;
  let result = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '(') {
      result += text[i];
      i++;
      continue;
    }
    // Try to find the matching close-paren on the same line, balanced.
    let depth = 1;
    let j = i + 1;
    let found = false;
    while (j < text.length && j - i < MAX_LEN) {
      const c = text[j];
      if (c === '\n') break; // bail out — single-line constraint
      if (c === '(') depth++;
      else if (c === ')') {
        depth--;
        if (depth === 0) {
          found = true;
          break;
        }
      }
      j++;
    }
    if (!found) {
      result += text[i];
      i++;
      continue;
    }
    const inner = text.slice(i + 1, j);
    const trimmed = inner.trim();
    if (looksLikeLatex(trimmed) && /^[\\a-zA-Z0-9{]/.test(trimmed)) {
      result += `$${inner}$`;
    } else {
      result += text.slice(i, j + 1);
    }
    i = j + 1;
  }
  return result;
}
