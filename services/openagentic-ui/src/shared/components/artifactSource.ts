/**
 * Pre-processing for React/TSX artifact source before it's handed to the
 * iframe's Babel standalone transformer.
 *
 * The iframe wrapper (CanvasPanel.buildPreviewHTML) already does:
 *   const { useState, useEffect, useRef, useMemo, useCallback, useReducer,
 *           useContext, createContext, memo, forwardRef, lazy, Suspense,
 *           Fragment } = React;
 *
 * If the model emits `import { useState } from "react";` Babel throws
 *   SyntaxError: Identifier 'useState' has already been declared
 * and the preview renders black. Same for `import React from "react"` or
 * `import * as React from "react"` — React is already a UMD global.
 *
 * This module exports:
 *   - stripReactImports() — remove every react import (since everything is
 *     already in scope via the UMD global).
 *   - stripExports()      — rewrite `export default`, `export function`,
 *     `export const` so Babel accepts the source as a plain script. Pulled
 *     out of CanvasPanel so it can be unit-tested.
 *   - sanitizeArtifactSource() — composition of the above; what the iframe
 *     actually injects.
 */

/**
 * Remove `import … from 'react'` / `from "react"` statements. React is
 * provided as a UMD global and hooks are pre-destructured in the iframe
 * wrapper, so these imports only cause re-declaration conflicts.
 *
 * Handles the full grammar:
 *   import React from 'react';
 *   import * as React from "react";
 *   import { useState } from 'react';
 *   import { useState, useEffect, type FC } from "react";
 *   import React, { useState } from 'react';
 *
 * Non-react imports (reactflow, @xyflow, lucide-react, etc.) are left
 * alone — the artifact runtime can still fail those, but that is the
 * prompt's job to prevent, not this sanitiser.
 */
export function stripReactImports(source: string): string {
  // Match `import …from 'react';` or `from "react";` with optional
  // trailing newline. The `\s+from\s+` anchor keeps us from eating
  // `import 'react-something';` side-effect imports, and the exact
  // `['"]react['"]` anchor keeps `reactflow` / `react-dom` safe.
  const pattern = /^\s*import\s+[^;'"`]+?\s+from\s+['"]react['"]\s*;?\s*$/gm;
  return source.replace(pattern, '');
}

/**
 * Rewrite top-level `export` forms so Babel can evaluate the source as a
 * script (not a module). The iframe maps `export default` to a tracking
 * variable `__EXPORT_DEFAULT__` so the runtime can find the component to
 * mount without real ESM semantics.
 */
export function stripExports(source: string): string {
  return source
    .replace(/export\s+default\s+function\s+(\w+)/g, 'function $1')
    .replace(/export\s+default\s+(\w+)\s*;?/g, '__EXPORT_DEFAULT__ = $1;')
    .replace(/export\s+function\s+(\w+)/g, 'function $1')
    .replace(/export\s+const\s+(\w+)/g, 'const $1');
}

/** Full sanitisation chain applied before the Babel script tag. */
export function sanitizeArtifactSource(source: string): string {
  return stripExports(stripReactImports(source));
}
