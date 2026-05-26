/**
 * Monaco singleton loader. Lazy-imports `monaco-editor` only when getMonaco()
 * is first called so the heavy package (~3 MB gz) is split into its own
 * chunk and doesn't poison the module-load graph at build time.
 *
 * The previous static `import * as monaco from 'monaco-editor'` caused
 * Vite/Rollup to drop the entire FilePanel branch from the bundle —
 * monaco-editor's side-effect imports (workers, AMD shim) prevent it
 * from being treated as a normal ES module dependency. Dynamic import
 * defers all of that to first paint.
 */
import { loader } from '@monaco-editor/react';
import { registerCmThemes } from './monacoThemes';

type MonacoNamespace = typeof import('monaco-editor');

let monacoPromise: Promise<MonacoNamespace> | null = null;
let themesRegistered = false;

/** Resolve the Monaco namespace, registering cm-* themes on first call. */
export function getMonaco(): Promise<MonacoNamespace> {
  if (!monacoPromise) {
    monacoPromise = (async () => {
      const monaco = await import('monaco-editor');
      loader.config({ monaco });
      const m = (await loader.init()) as unknown as MonacoNamespace;
      if (!themesRegistered) {
        registerCmThemes(m);
        themesRegistered = true;
      }
      return m;
    })();
  }
  return monacoPromise;
}

export { registerCmThemes };
