/**
 * Task #158 — `browser_exec` system MCP.
 *
 * The in-browser Python/JS sandbox (matching Claude.ai's analysis tool)
 * is exposed to models as a *pseudo-tool* named `browser_exec`. Unlike
 * normal MCP tools, the server does not actually dispatch this tool —
 * it emits a `browser_exec_request` NDJSON frame instead and awaits a
 * matching `browser_exec_result` envelope from the UI via
 * `POST /api/chat/sandbox-result`.
 *
 * The prompt snippet below is injected into the model's system prompt
 * whenever the user's message suggests a computation the LLM could
 * avoid (large-number arithmetic, prime sieves, CSV parsing, quick
 * histogram). The wording mirrors Claude.ai's own analysis-tool
 * description so the model's existing trained behaviour carries over.
 *
 * We deliberately do NOT add `browser_exec` to the MCP tool manifest —
 * the pipeline translates the model's tool-call JSON to a
 * `browser_exec_request` event via the emit path in ChatPipeline.
 * The consumer side (sandboxManager) runs it and POSTs the envelope
 * back.
 */

export const BROWSER_EXEC_SYSTEM_PROMPT = `
## Browser Sandbox — Analysis Tool

You can run a short Python or JavaScript snippet inside the user's
browser and see its output. Use this for: exact arithmetic on large
integers, computing sums / statistics over lists, parsing CSV or
JSON the user pasted, quick plots (matplotlib is available), string
crunching where you'd otherwise guess. **Do not** use it for anything
that needs network access, the filesystem, or more than ~5 seconds
of CPU — the sandbox enforces a hard 5 s timeout.

### How to invoke

Request execution by calling the \`browser_exec\` tool with:

\`\`\`json
{
  "language": "python",  // or "javascript"
  "code": "…",
  "title": "optional UI label"
}
\`\`\`

### Python sandbox

Runs Pyodide inside a Web Worker. Preloaded: \`numpy\`, \`pandas\`,
\`matplotlib\`. You may \`import\` any of these plus the Python stdlib.
Call \`plt.show()\` to surface figures — they are captured as PNG and
rendered inline. The last expression's \`repr()\` is returned.

### JavaScript sandbox

Runs inside a \`sandbox="allow-scripts"\` iframe (no cookies, no
\`localStorage\`, no cross-origin reads, no network). The code is
wrapped in an \`async () => {...}\` runner, so top-level \`await\` is
fine. Return the value you want to surface.

### When to use

- "What's the sum of primes under 10000?" → Python.
- "Plot the distribution of values in [1,2,3,…]" → Python + matplotlib.
- "Parse this CSV I pasted" → Python pandas.
- "Compute the mean of these 50 numbers" → JavaScript (trivial path).

### When NOT to use

- Anything requiring a network call, login, or file I/O.
- Any snippet that runs longer than 5 s.
- Cryptographic or authentication-related computation.
- When a user asks a question that has a direct factual answer you
  already know — don't burn a round-trip just to show off.
`.trimStart();

/**
 * Minimal tool definition injected into the model's tool manifest.
 * The pipeline sees a call to \`browser_exec\` and emits the NDJSON
 * request frame; it is NOT routed to the normal MCP bridge.
 */
export const BROWSER_EXEC_TOOL_DEFINITION = {
  name: 'browser_exec',
  description:
    'Run a short Python or JavaScript snippet inside the user browser sandbox and return stdout/stderr/returnValue. Hard 5s timeout. No network, no filesystem.',
  input_schema: {
    type: 'object',
    properties: {
      language: {
        type: 'string',
        enum: ['python', 'javascript'],
        description: 'Sandbox runtime.',
      },
      code: {
        type: 'string',
        description: 'Source to execute. Must be a single module-level snippet.',
      },
      title: {
        type: 'string',
        description: 'Optional human-readable label shown on the sandbox card.',
      },
    },
    required: ['language', 'code'],
  },
};

/**
 * Cheap keyword gate. Returns true when the user's message contains
 * vocabulary that strongly suggests inline computation would help.
 * Prompt injection is opt-in per turn — we don't want to burn tokens
 * on the prompt section for every casual message.
 */
export function suggestsBrowserExec(message: string): boolean {
  if (!message) return false;
  const m = message.toLowerCase();
  return (
    /\bprime(s)?\b/.test(m) ||
    /\bsum\s+of\b/.test(m) ||
    /\b(compute|calculate|evaluate)\b/.test(m) ||
    /\b(parse|process)\s+(this\s+)?(csv|json|data)\b/.test(m) ||
    /\b(histogram|plot|chart|matplotlib|numpy|pandas)\b/.test(m) ||
    /\b(python|javascript|js)\s+code\b/.test(m) ||
    /\brun\s+(this|the)\s+(python|javascript|js|code)\b/.test(m)
  );
}
