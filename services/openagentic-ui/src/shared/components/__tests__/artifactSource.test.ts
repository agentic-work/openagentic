/**
 * Regression: the CanvasPanel iframe pre-declares `const { useState, … } =
 * React` before injecting the model's source. When the model emits
 * `import { useState } from "react"` Babel throws "Identifier 'useState'
 * has already been declared" and the preview renders black.
 *
 * Fix in artifactSource.ts: strip every react import pre-injection since
 * React and its hooks are already global in the iframe.
 */
import { describe, it, expect } from 'vitest';
import {
  stripReactImports,
  stripExports,
  sanitizeArtifactSource,
} from '../artifactSource';

describe('stripReactImports', () => {
  it('removes `import { useState } from "react";` (double-quoted)', () => {
    const src = `import { useState } from "react";\nfunction App() { return null; }`;
    expect(stripReactImports(src)).not.toContain('import');
    expect(stripReactImports(src)).toContain('function App()');
  });

  it("removes `import { useState } from 'react';` (single-quoted)", () => {
    const src = `import { useState } from 'react';\nfunction App() { return null; }`;
    expect(stripReactImports(src)).not.toContain('import');
  });

  it('removes `import { useState, useEffect } from "react";`', () => {
    const src = `import { useState, useEffect } from "react";\nfoo();`;
    expect(stripReactImports(src)).not.toContain('import');
  });

  it('removes `import React from "react";`', () => {
    const src = `import React from "react";\nfoo();`;
    expect(stripReactImports(src)).not.toContain('import');
  });

  it('removes `import * as React from "react";`', () => {
    const src = `import * as React from "react";\nfoo();`;
    expect(stripReactImports(src)).not.toContain('import');
  });

  it('removes `import React, { useState } from "react";`', () => {
    const src = `import React, { useState } from "react";\nfoo();`;
    expect(stripReactImports(src)).not.toContain('import');
  });

  it('removes multiple react imports', () => {
    const src = `import React from "react";\nimport { useState } from "react";\nfoo();`;
    const out = stripReactImports(src);
    expect(out).not.toContain('import');
    expect(out).toContain('foo()');
  });

  it('LEAVES non-react imports alone (reactflow, react-dom, lucide-react)', () => {
    const src = [
      'import ReactFlow from "reactflow";',
      "import { createRoot } from 'react-dom/client';",
      'import { Code } from "lucide-react";',
      'function App() { return null; }',
    ].join('\n');
    const out = stripReactImports(src);
    expect(out).toContain('from "reactflow"');
    expect(out).toContain("from 'react-dom/client'");
    expect(out).toContain('from "lucide-react"');
  });

  it('leaves code that has no react imports unchanged', () => {
    const src = `function App() { return <div>hi</div>; }`;
    expect(stripReactImports(src)).toBe(src);
  });
});

describe('stripExports', () => {
  it('rewrites `export default function App()` to `function App()`', () => {
    const src = `export default function App() { return null; }`;
    expect(stripExports(src)).toBe('function App() { return null; }');
  });

  it('rewrites `export default App;` to `__EXPORT_DEFAULT__ = App;`', () => {
    const src = `function App() { return null; }\nexport default App;`;
    expect(stripExports(src)).toContain('__EXPORT_DEFAULT__ = App;');
    expect(stripExports(src)).not.toContain('export default');
  });

  it('rewrites `export function Foo()` to `function Foo()`', () => {
    const src = `export function Foo() { return 1; }`;
    expect(stripExports(src)).toBe('function Foo() { return 1; }');
  });

  it('rewrites `export const x = …` to `const x = …`', () => {
    const src = `export const COLORS = { bg: '#000' };`;
    expect(stripExports(src)).toBe(`const COLORS = { bg: '#000' };`);
  });
});

describe('sanitizeArtifactSource (full chain — iframe injection)', () => {
  it('strips react imports AND rewrites export default in one pass', () => {
    const src = [
      'import { useState } from "react";',
      'export default function Architecture() {',
      '  const [layer, setLayer] = useState(0);',
      '  return <div>{layer}</div>;',
      '}',
    ].join('\n');
    const out = sanitizeArtifactSource(src);
    expect(out).not.toMatch(/import\s+[^;]+from\s+['"]react['"]/);
    expect(out).not.toContain('export default');
    expect(out).toContain('function Architecture()');
    expect(out).toContain('useState(0)');
  });

  it('handles the exact shape that hit the bug (Claude arch diagram)', () => {
    const src = [
      'var __LAST_COMPONENT__ = null;',
      'var __EXPORT_DEFAULT__ = null;',
      'import { useState } from "react";',
      '',
      'const COLORS = { bg: "#0b0f1a" };',
      'function Layer({ title, children }) { return <section>{children}</section>; }',
      'export default function Architecture() { return <Layer title="Edge">hi</Layer>; }',
    ].join('\n');
    const out = sanitizeArtifactSource(src);
    // react import gone → no "useState has already been declared" SyntaxError
    expect(out).not.toMatch(/import\s+\{?\s*useState/);
    // export default rewritten to plain function
    expect(out).toContain('function Architecture()');
    expect(out).not.toContain('export default');
  });
});
