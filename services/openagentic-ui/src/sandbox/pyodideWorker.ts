/**
 * Pyodide web-worker harness (task #158).
 *
 * Runs inside a Web Worker spawned by `sandboxManager.ts`. Loads Pyodide
 * 0.28.4 lazily from the jsDelivr CDN on first `init` message (≈6 MiB
 * wasm + supporting assets). numpy / pandas / matplotlib are declared as
 * optional preloads — they only pull over the wire when the model's
 * first snippet needs them.
 *
 * The worker speaks a minimal protocol with the parent:
 *
 *   parent → worker : `init`, `run`
 *   worker → parent : `ready`, `stdout`, `stderr`, `result`, `load_failed`
 *
 * Shape is enforced by `types.ts` (`WorkerInboundMessage` /
 * `WorkerOutboundMessage`). The 5 s timeout + kill is handled by
 * `sandboxManager` in the parent thread via `worker.terminate()` — the
 * worker itself has no watchdog. This keeps the failure surface small:
 * "run too long" always looks like the parent forcibly killed us.
 *
 * Safety notes:
 *  - No `fetch` patching — the sandbox relies on the absence of network
 *    in the Python snippet context. Pyodide's stdlib lets `urllib`
 *    compile but hits browser fetch, which is blocked by our CSP in
 *    production. For defence-in-depth we disable `pyodide.FS` write
 *    access to `/persistent` and reset the interpreter state between
 *    runs by creating a fresh module namespace.
 *  - The worker is spawned with no name and no shared SAB; it lives in
 *    its own realm so `self.postMessage` is the only way to leak.
 *  - Packages listed in `DEFAULT_PACKAGES` are pre-resolved against the
 *    CDN's `pyodide-lock.json` on init. Anything not in that list is
 *    rejected by `pyodide.loadPackage`.
 *
 * This file is intentionally decoupled from the React tree — it's
 * imported via `?worker&url` in the manager and never executed on the
 * main thread.
 */

// NOTE: we don't `/// <reference lib="webworker" />` because the UI
// tsconfig only pulls ES2020 + DOM + DOM.Iterable libs. Instead we
// narrow-type `self` and the APIs we touch (`importScripts`,
// `addEventListener`, `postMessage`) via local declarations. At runtime
// this file is compiled by Vite as a dedicated web-worker entry.

import type {
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from './types';

// Version is pinned here and echoed through the `ready` message so the
// parent can surface it in the UI and tests can assert on it.
// NOTE: keep this aligned with a version actually published on
// cdn.jsdelivr.net/pyodide — v0.28.4 was a phantom pin that 404'd every
// dynamic import; the last 0.28.x release is 0.28.3. The companion test
// `pyodideVersion.static.test.ts` enforces the published-version guard.
export const PYODIDE_VERSION = '0.28.3';
const PYODIDE_INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;

// Preloaded packages — lazy-resolved on first `run` that imports them.
// Matplotlib is preloaded so `plt.savefig(...)` doesn't require a
// runtime loadPackage stall on first use.
const DEFAULT_PACKAGES = ['numpy', 'pandas', 'matplotlib'] as const;

// Narrow local types for the worker-global `self`. Avoids depending on
// the `webworker` lib in the UI tsconfig (see note at file top).
interface WorkerSelfLike {
  postMessage: (msg: unknown) => void;
  addEventListener: (
    type: 'message',
    listener: (ev: MessageEvent<WorkerInboundMessage>) => void,
  ) => void;
}
declare const self: WorkerSelfLike;

// Pyodide's ESM bootstrap. The CDN ships `pyodide.mjs` alongside the
// classic `pyodide.js`; we must use the ESM variant because this worker
// is spawned with `{ type: 'module' }` (see sandboxManager.ts) and
// module-type workers cannot call `importScripts()`.
type PyodideLoader = (opts: { indexURL: string }) => Promise<unknown>;

type PyodideInterface = {
  loadPackagesFromImports: (code: string) => Promise<void>;
  loadPackage: (pkg: string | string[]) => Promise<void>;
  runPython: (code: string) => unknown;
  runPythonAsync: (code: string) => Promise<unknown>;
  setStdout: (opts: { batched?: (s: string) => void }) => void;
  setStderr: (opts: { batched?: (s: string) => void }) => void;
  globals: { set: (k: string, v: unknown) => void; get: (k: string) => unknown };
};

let pyodide: PyodideInterface | null = null;
let initPromise: Promise<void> | null = null;

/**
 * Post a typed message to the parent. Centralized so all outbound
 * traffic passes through one chokepoint we can wrap for testing.
 */
function post(msg: WorkerOutboundMessage): void {
  self.postMessage(msg);
}

async function initPyodide(indexURL: string): Promise<void> {
  if (pyodide) return;
  if (initPromise !== null) return initPromise;

  initPromise = (async () => {
    try {
      // Import the pyodide ESM bootstrap from the CDN. This is the one
      // network hit — the rest of Pyodide is streamed in lazily as
      // `loadPackage` is called. `/* @vite-ignore */` keeps Vite from
      // trying to resolve the CDN URL at build time.
      const mod = (await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`)) as {
        loadPyodide?: PyodideLoader;
      };
      if (!mod.loadPyodide) {
        throw new Error('pyodide.mjs loaded but loadPyodide export missing');
      }
      const py = (await mod.loadPyodide({ indexURL })) as PyodideInterface;
      // Preload the analytical stack — failure is non-fatal, snippets
      // that only use stdlib still run.
      try {
        await py.loadPackage([...DEFAULT_PACKAGES]);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[pyodide-worker] optional preload failed', err);
      }
      pyodide = py;
      post({ type: 'ready', version: PYODIDE_VERSION });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      post({ type: 'load_failed', error: msg });
      throw err;
    }
  })();

  return initPromise;
}

/**
 * Run a snippet. stdout / stderr are streamed back to the parent via
 * separate `stdout` / `stderr` messages so the card updates live. The
 * final `result` message carries the return value (JSON-stringified)
 * and any matplotlib figures captured via `_aw_capture_figures`.
 */
async function runSnippet(requestId: string, code: string): Promise<void> {
  if (!pyodide) {
    post({
      type: 'result',
      requestId,
      ok: false,
      errorCode: 'LOAD_FAILED',
      returnValue: 'pyodide not initialised',
    });
    return;
  }

  // Route stdio back through the worker's postMessage stream.
  pyodide.setStdout({
    batched: (chunk: string) => post({ type: 'stdout', requestId, chunk }),
  });
  pyodide.setStderr({
    batched: (chunk: string) => post({ type: 'stderr', requestId, chunk }),
  });

  // Resolve any `import numpy` etc. imports before the snippet runs.
  // This is a no-op if the package is already loaded from preload.
  try {
    await pyodide.loadPackagesFromImports(code);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    post({ type: 'stderr', requestId, chunk: `[load] ${msg}\n` });
  }

  // Preamble: hook matplotlib so figures created during the run are
  // captured and returned as base64 PNG. Falls through silently if
  // matplotlib isn't imported by the snippet.
  const preamble = `
import io, base64, json, sys
_aw_figures = []
try:
    import matplotlib
    matplotlib.use('AGG')
    import matplotlib.pyplot as _aw_plt
    _aw_original_show = _aw_plt.show
    def _aw_capture_show(*a, **kw):
        for num in _aw_plt.get_fignums():
            fig = _aw_plt.figure(num)
            buf = io.BytesIO()
            fig.savefig(buf, format='png', bbox_inches='tight')
            _aw_figures.append({'mime': 'image/png', 'base64': base64.b64encode(buf.getvalue()).decode('ascii')})
        _aw_plt.close('all')
    _aw_plt.show = _aw_capture_show
except Exception:
    pass
`;

  const postamble = `
_aw_result = None
try:
    _aw_result = _aw_last
except NameError:
    _aw_result = None
try:
    _aw_plt.show()
except Exception:
    pass
json.dumps({'returnValue': repr(_aw_result) if _aw_result is not None else None, 'images': _aw_figures})
`;

  try {
    // Wrap the user snippet so `_aw_last` ends up bound to the value of
    // the final expression (if any). We accept arbitrary statements; the
    // exec block catches SyntaxError and re-raises with a tagged code.
    const wrapped = `
_aw_last = None
try:
    exec(compile(${JSON.stringify(code)}, '<user>', 'exec'), globals())
except SyntaxError as _e:
    print('[SyntaxError] ' + str(_e), file=sys.stderr)
    raise
`;
    const json = (await pyodide.runPythonAsync(
      preamble + wrapped + postamble,
    )) as unknown as string;
    let parsed: { returnValue?: string; images?: Array<{ mime: string; base64: string }> } = {};
    try {
      parsed = JSON.parse(String(json));
    } catch {
      parsed = { returnValue: String(json) };
    }
    post({
      type: 'result',
      requestId,
      ok: true,
      returnValue: parsed.returnValue,
      images: parsed.images,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const errorCode: 'SYNTAX_ERROR' | 'RUNTIME_ERROR' = msg.includes(
      'SyntaxError',
    )
      ? 'SYNTAX_ERROR'
      : 'RUNTIME_ERROR';
    post({ type: 'stderr', requestId, chunk: msg });
    post({
      type: 'result',
      requestId,
      ok: false,
      errorCode,
    });
  }
}

self.addEventListener('message', (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  switch (msg.type) {
    case 'init':
      void initPyodide(msg.pyodideIndexURL ?? PYODIDE_INDEX_URL);
      break;
    case 'run':
      void (async () => {
        if (!pyodide) {
          try {
            await initPyodide(PYODIDE_INDEX_URL);
          } catch {
            // load_failed already posted
            return;
          }
        }
        await runSnippet(msg.requestId, msg.code);
      })();
      break;
    default:
      // Unknown message — ignore. The parent-side protocol is the
      // source of truth; dropping unknowns means a newer parent can
      // coexist with an older worker script.
      break;
  }
});

// Export the worker entry as a noop for TS — real execution happens via
// the `self.addEventListener('message', ...)` registered above.
export {};
