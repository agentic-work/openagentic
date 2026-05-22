// Post-build script: adds .js extensions to relative imports in dist output
// so that Node ESM resolution works correctly with "type": "module".
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const DIST = new URL('../dist', import.meta.url).pathname;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (e.name.endsWith('.js') || e.name.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

// Match: from './foo'  or  from '../foo'  or  import('./foo')  or  export * from './foo'
// But NOT if it already ends with .js or .ts
const RE = /(from\s+['"])(\.[^'"]*?)(['"])/g;
const RE_DYNAMIC = /(import\(\s*['"])(\.[^'"]*?)(['"]\s*\))/g;

function fixLine(match, pre, specifier, post) {
  // Already has extension
  if (specifier.endsWith('.js') || specifier.endsWith('.ts') || specifier.endsWith('.json')) {
    return match;
  }
  return `${pre}${specifier}.js${post}`;
}

let changed = 0;
const files = await walk(DIST);
for (const f of files) {
  const src = await readFile(f, 'utf8');
  let out = src.replace(RE, fixLine).replace(RE_DYNAMIC, fixLine);
  if (out !== src) {
    await writeFile(f, out);
    changed++;
  }
}
console.log(`fix-esm-imports: patched ${changed} files`);
