/**
 * C1 (FedRAMP P3 / NIST SI-10, IA-2) — every jwt.verify() in src must pin the
 * accepted algorithm(s).
 *
 * Without an explicit `algorithms` allow-list, jsonwebtoken accepts whatever
 * `alg` the token header claims — the classic algorithm-confusion / `alg:none`
 * class. After the AAD/OBO excision the OSS edition verifies only HS256
 * (inter-service + local) and a couple of RS256 (Teams/JWKS) tokens; both must
 * be pinned. This source-regression test fails if any unpinned jwt.verify is
 * (re)introduced.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__' || entry === 'tests') continue;
      out.push(...walk(p));
    } else if (p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Find jwt.verify( call sites and, for each, capture the argument text up to a
 * reasonable window so we can assert an `algorithms:` option is present. We scan
 * a ~6-line window after the call open because the options object is often
 * multi-line (RS256/JWKS form).
 */
function unpinnedJwtVerifySites(): string[] {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const text = readFileSync(file, 'utf8');
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // real call site only (skip comments / prose mentions)
      const trimmed = line.trim();
      if (trimmed.startsWith('*') || trimmed.startsWith('//')) continue;
      if (!/\bjwt\.verify\s*\(/.test(line)) continue;
      const windowText = lines.slice(i, i + 8).join('\n');
      if (!/algorithms\s*:/.test(windowText)) {
        offenders.push(`${file.replace(SRC, 'src')}:${i + 1}  ${trimmed}`);
      }
    }
  }
  return offenders;
}

describe('JWT algorithms pinned (C1)', () => {
  it('every jwt.verify() in src pins an algorithms allow-list', () => {
    const offenders = unpinnedJwtVerifySites();
    expect(offenders, `Unpinned jwt.verify sites (add { algorithms: [...] }):\n${offenders.join('\n')}`).toEqual([]);
  });
});
