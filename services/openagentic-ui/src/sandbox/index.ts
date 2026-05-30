/**
 * Browser-sandbox package entrypoint (task #158).
 *
 * Public surface:
 *   - `getSandboxManager()` — singleton used by `useChatStream`
 *   - types for the wire contract (`BrowserExecRequest`, `BrowserExecResult`)
 *   - `SANDBOX_LIMITS` for UI copy
 *   - test helpers
 */

export {
  SandboxManager,
  getSandboxManager,
  setSandboxManagerForTest,
} from './sandboxManager';
export type {
  WorkerFactory,
  JsSandboxFactory,
} from './sandboxManager';
export {
  createJsSandbox,
  iframeLoadFailedResult,
} from './jsIframeSandbox';
export type { JsSandboxHandle } from './jsIframeSandbox';
export { PYODIDE_VERSION } from './pyodideWorker';
export type {
  BrowserExecRequest,
  BrowserExecResult,
  SandboxLanguage,
  WorkerInboundMessage,
  WorkerOutboundMessage,
} from './types';
export { SANDBOX_LIMITS } from './types';
