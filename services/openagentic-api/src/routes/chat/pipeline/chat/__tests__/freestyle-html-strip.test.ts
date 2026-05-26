/**
 * #925 — freestyle HTML leak detection + synthetic render_artifact rescue.
 *
 * Symptom: model emits a raw `<!doctype html>...</html>` or standalone
 * `<style>...</style>` block inside its text response when it intended to
 * call a UI tool. Without a server-side strip, those bytes leak into the
 * assistant body and contaminate the chat layout with page-level CSS.
 *
 * The first attempt (`stripBareHtmlPayload`, commit `3f7d9171`, reverted
 * 19 minutes later in `52fe6712`) only deleted the bytes — the iframe
 * never mounted because no tool_use replacement was synthesized. This
 * round, the helper not only strips but also surfaces a structured
 * `{ kind, content }` payload that chatLoop can repackage into a
 * synthetic `render_artifact` tool_use block so the UI mounts a proper
 * sandboxed iframe via the existing AppRenderer path.
 *
 * Design constraints:
 *   - The `<compose_app>...</compose_app>` XML rescue shape (owned by
 *     the inline-compose rescue path) MUST NOT match — those are stripped
 *     and dispatched as compose_app tool_use frames there.
 *   - HTML inside a markdown code fence (```html ... ```) is a legitimate
 *     code example and MUST be preserved verbatim — only BARE leaks get
 *     stripped.
 *   - Empty / null / non-string input returns an empty result without
 *     throwing.
 *
 * RED tests pin exact shapes observed live on chat-dev (#925).
 */
import { describe, it, expect } from 'vitest';
import { stripFreestyleHtml } from '../stripFreestyleHtml.js';

describe('stripFreestyleHtml (#925)', () => {
  it('strips bare doctype-rooted HTML doc and surfaces it as a freestyle payload', () => {
    const text = `Here is the dashboard:

<!doctype html>
<html>
<head><meta charset="utf-8"><title>Dashboard</title></head>
<body>
  <div id="leaked-secret">Cluster status</div>
</body>
</html>

That's the layout.`;

    const result = stripFreestyleHtml(text);
    expect(result.stripped).not.toContain('<!doctype');
    expect(result.stripped).not.toContain('<html');
    expect(result.stripped).not.toContain('leaked-secret');
    expect(result.stripped).toContain("Here is the dashboard");
    expect(result.stripped).toContain("That's the layout.");
    expect(result.freestylePayloads).toHaveLength(1);
    expect(result.freestylePayloads[0].kind).toBe('html');
    expect(result.freestylePayloads[0].content).toContain('leaked-secret');
  });

  it('strips bare <html>...</html> block without leading doctype', () => {
    const text = `<html><body><h1>headline</h1></body></html>`;
    const result = stripFreestyleHtml(text);
    expect(result.stripped).toBe('');
    expect(result.freestylePayloads).toHaveLength(1);
    expect(result.freestylePayloads[0].kind).toBe('html');
    expect(result.freestylePayloads[0].content).toContain('headline');
  });

  it('strips standalone <style>...</style> block surfaced as html payload', () => {
    const text = `Setting styles:
<style>
  .leak { color: red; background: black; }
  body { margin: 0; }
</style>
Done.`;
    const result = stripFreestyleHtml(text);
    expect(result.stripped).not.toContain('<style');
    expect(result.stripped).not.toContain('.leak');
    expect(result.stripped).toContain('Setting styles:');
    expect(result.stripped).toContain('Done.');
    expect(result.freestylePayloads).toHaveLength(1);
    expect(result.freestylePayloads[0].content).toContain('.leak');
  });

  it('DOES NOT strip HTML inside a markdown code fence', () => {
    const text = `Here is the HTML you asked about:
\`\`\`html
<!doctype html>
<html>
  <body><p>example</p></body>
</html>
\`\`\`
That is the canonical shape.`;
    const result = stripFreestyleHtml(text);
    expect(result.stripped).toBe(text);
    expect(result.freestylePayloads).toHaveLength(0);
  });

  it('DOES NOT strip <compose_app>...</compose_app> rescue XML', () => {
    // The rescue path (rescueInlineComposePatterns) owns this shape.
    const text = `<compose_app template="cluster-inventory" params={"items":[{"k":"v"}]}>`;
    const result = stripFreestyleHtml(text);
    expect(result.stripped).toBe(text);
    expect(result.freestylePayloads).toHaveLength(0);
  });

  it('passes through plain prose without modification (no false positives)', () => {
    const text = `Pods in agentic-dev: 26 running, 1 pending. Latest deploy SHA 0.7.1-abcdef. ` +
      `Cost MoM delta: +12.3%. The < and > characters here are punctuation, not tags.`;
    const result = stripFreestyleHtml(text);
    expect(result.stripped).toBe(text);
    expect(result.freestylePayloads).toHaveLength(0);
  });

  it('handles empty / null / non-string input safely', () => {
    expect(stripFreestyleHtml('').freestylePayloads).toHaveLength(0);
    expect(stripFreestyleHtml('').stripped).toBe('');
    // Non-string input must not throw.
    expect(stripFreestyleHtml(null as unknown as string).freestylePayloads).toHaveLength(0);
    expect(stripFreestyleHtml(undefined as unknown as string).freestylePayloads).toHaveLength(0);
  });

  it('strips multiple bare HTML blocks in one body', () => {
    const text = `First widget:
<!doctype html><html><body>one</body></html>
Second widget:
<html><body>two</body></html>`;
    const result = stripFreestyleHtml(text);
    expect(result.freestylePayloads).toHaveLength(2);
    expect(result.freestylePayloads[0].content).toContain('one');
    expect(result.freestylePayloads[1].content).toContain('two');
    expect(result.stripped).toContain('First widget:');
    expect(result.stripped).toContain('Second widget:');
    expect(result.stripped).not.toContain('<html');
  });
});
