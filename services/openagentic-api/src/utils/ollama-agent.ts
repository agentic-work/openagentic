import { Agent } from 'undici';

/**
 * Shared undici Agent used by every Ollama fetch call. Node's native fetch
 * honours the per-call `dispatcher` option (bundled undici) but NOT
 * undici's setGlobalDispatcher when a separate copy is installed via npm —
 * so we build one agent here and pass it through explicitly.
 *
 * Defaults are tuned for an LLM gateway: many concurrent calls
 * (chat + embedding + probes), generous connect timeout (hal can be a
 * little slow to TCP-accept under load), keep-alive long enough that we
 * don't pay a handshake on every request.
 */
export const ollamaAgent = new Agent({
  connections: 64,
  connect: { timeout: 30_000 },
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  pipelining: 1,
});
