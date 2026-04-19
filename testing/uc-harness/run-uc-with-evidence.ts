#!/usr/bin/env bun
/**
 * UC harness runner with full-evidence capture.
 *
 * Fork of `run-uc.ts` that writes a reproducible artifact tree per run.
 * For every UC executed against /api/chat/stream, we persist:
 *
 *   evidence/uc/<UC-ID>/
 *     ├── request.json       { id, prompt, sessionId, model, ts, baseUrl }
 *     ├── response.ndjson    raw SSE frames (one JSON object per line, data: payload only)
 *     ├── assertions.json    { pass, reasons[], tools_expected, tools_found, patterns, textHash }
 *     └── timing.json        { ttfbMs, totalMs, eventCount, byteCount }
 *
 * Plus a top-level harness-runs/<ts>.log summary.
 *
 * Usage:
 *   UC_HARNESS_TOKEN=<jwt> bun testing/uc-harness/run-uc-with-evidence.ts <yaml-path> \
 *     [--evidence-dir docs/releases/0.6.6-evidence]
 *
 * If UC_HARNESS_TOKEN is unset, the runner tries to read `.uc-harness-token`
 * in the cwd (produced by `scripts/generate-uc-harness-token.sh`). If that
 * also isn't there, the run aborts with exit 1.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { createHash } from "node:crypto";

// ---------- types ----------
type UC = {
  id: string;
  prompt: string;
  expected_tools: string[];
  expected_patterns: string[];
  // When the platform correctly short-circuits (DLP block, content filter,
  // gate auto-deny), the stream terminates with an `error` event — that's
  // the PASS signal. Setting this to `true` makes the harness treat any
  // stream-side error as acceptable so long as the other assertions still
  // hold.
  allow_stream_error?: boolean;
  // SSE event kinds that MUST be seen in the NDJSON. Good for asserting
  // on out-of-band signals the LLM text won't surface (HITL approval
  // required, DLP redaction notice, truncation marker, etc.).
  expected_events?: string[];
  // Regex strings that MUST NOT match the final assistantText. Used for
  // negative assertions like "the AWS key must not be echoed back".
  forbidden_patterns?: string[];
  timeout_s: number;
  model?: string;
};

type RunResult = {
  assistantText: string;      // concatenated text-block content only (no thinking)
  thinkingText: string;       // concatenated thinking-block content (for evidence, not asserted)
  toolCalls: string[];
  eventTypes: string[];       // every SSE event kind observed (order of arrival)
  durationMs: number;
  ttfbMs: number;
  eventCount: number;
  byteCount: number;
  rawNdjsonPath: string;
  errored: boolean;
  errorMsg?: string;
};

// ---------- tiny yaml (same dialect as run-uc.ts) ----------
function parseYaml(src: string): UC[] {
  const out: UC[] = [];
  const lines = src.split(/\r?\n/);
  let cur: any = null;
  let listKey: string | null = null;

  const flush = () => {
    if (!cur) return;
    cur.expected_tools = cur.expected_tools ?? [];
    cur.expected_patterns = cur.expected_patterns ?? [];
    cur.expected_events = cur.expected_events ?? [];
    cur.forbidden_patterns = cur.forbidden_patterns ?? [];
    cur.timeout_s = Number(cur.timeout_s ?? 120);
    if (typeof cur.allow_stream_error === "string") {
      cur.allow_stream_error = cur.allow_stream_error === "true";
    } else {
      cur.allow_stream_error = cur.allow_stream_error === true;
    }
    out.push(cur as UC);
    cur = null;
    listKey = null;
  };

  const unquote = (v: string) => {
    v = v.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      return v.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return v;
  };

  for (const raw of lines) {
    const line = raw.replace(/\t/g, "  ");
    if (!line.trim() || line.trim().startsWith("#")) continue;

    const itemMatch = line.match(/^-\s+(.*)$/);
    if (itemMatch && !line.startsWith("  ")) {
      flush();
      cur = {};
      const rest = itemMatch[1];
      const kv = rest.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
      if (kv) {
        const [, k, v] = kv;
        if (v === "" || v === "[]") {
          if (v === "[]") cur[k] = [];
          else listKey = k;
        } else {
          cur[k] = unquote(v);
        }
      }
      continue;
    }

    const subItem = line.match(/^\s+-\s+(.*)$/);
    if (subItem && cur && listKey) {
      cur[listKey] = cur[listKey] ?? [];
      cur[listKey].push(unquote(subItem[1]));
      continue;
    }

    const kvLine = line.match(/^\s+([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (kvLine && cur) {
      const [, k, v] = kvLine;
      if (v === "" ) {
        listKey = k;
        cur[k] = [];
      } else if (v === "[]") {
        cur[k] = [];
        listKey = null;
      } else {
        cur[k] = unquote(v);
        listKey = null;
      }
    }
  }
  flush();
  return out;
}

// ---------- session ----------
async function createSession(base: string, token: string, title: string, model?: string): Promise<string> {
  const body: any = { title };
  if (model) body.model = model;
  const resp = await fetch(`${base}/api/chat/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`session create HTTP ${resp.status}: ${text.slice(0, 200)}`);
  }
  const j: any = await resp.json();
  const id = j?.session?.id ?? j?.id ?? j?.data?.id;
  if (!id) throw new Error(`session create: no id in response ${JSON.stringify(j).slice(0, 200)}`);
  return id;
}

// ---------- SSE chat call with evidence capture ----------
async function runChat(base: string, token: string, uc: UC, evidenceDir: string): Promise<RunResult> {
  const ucDir = join(evidenceDir, "uc", uc.id);
  mkdirSync(ucDir, { recursive: true });
  const rawNdjsonPath = join(ucDir, "response.ndjson");
  const ndjsonLines: string[] = [];

  // Create a fresh, owned session per UC so runs don't cross-contaminate.
  const sessionId = await createSession(base, token, `UC harness ${uc.id}`, uc.model);

  // Persist request artifact up front.
  writeFileSync(join(ucDir, "request.json"), JSON.stringify({
    id: uc.id,
    prompt: uc.prompt,
    sessionId,
    model: uc.model ?? null,
    baseUrl: base,
    ts: new Date().toISOString(),
    timeout_s: uc.timeout_s,
  }, null, 2));

  const body: any = { message: uc.prompt, sessionId };
  if (uc.model) body.model = uc.model;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), uc.timeout_s * 1000);
  const start = Date.now();
  let ttfbMs = 0;

  let assistantText = "";
  let thinkingText = "";
  const toolCalls: string[] = [];
  const eventTypes: string[] = [];
  let errored = false;
  let errorMsg: string | undefined;
  let eventCount = 0;
  let byteCount = 0;

  try {
    const resp = await fetch(`${base}/api/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    ttfbMs = Date.now() - start;

    if (!resp.ok || !resp.body) {
      errored = true;
      errorMsg = `HTTP ${resp.status}`;
      const text = await resp.text().catch(() => "");
      if (text) ndjsonLines.push(JSON.stringify({ type: "__http_error", status: resp.status, body: text.slice(0, 2000) }));
      return finish();
    }

    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    // SSE envelopes are `event: <name>\ndata: <payload>\n\n`. The event
    // kind lives in the `event:` line, NOT in the JSON payload — so we must
    // remember the most recent event label and attach it to the next data
    // frame. (The prior version of this parser was reading evt.type off the
    // payload and always getting undefined, which silently dropped every
    // content_block_delta — producing empty assistantText and spurious
    // harness failures. See docs/releases/0.6.6-evidence/harness-runs for
    // the initial broken run.)
    let pendingEvent: string | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value?.byteLength ?? 0;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);

        if (line.startsWith("event:")) {
          pendingEvent = line.slice(6).trim();
          continue;
        }
        if (!line.startsWith("data:")) {
          // blank line between stanzas, ignore
          continue;
        }
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") {
          pendingEvent = null;
          continue;
        }

        try {
          const evt = JSON.parse(payload);
          eventCount++;
          // Persist the SSE event kind alongside the JSON payload so
          // response.ndjson is self-describing.
          const labeled = pendingEvent
            ? JSON.stringify({ event: pendingEvent, ...evt })
            : payload;
          ndjsonLines.push(labeled);

          const t = pendingEvent || evt.type || evt.event;
          if (typeof t === "string") eventTypes.push(t);

          if (t === "content_block_delta" && typeof evt.content === "string") {
            if (evt.blockType === "thinking") {
              thinkingText += evt.content;
            } else {
              // text, answer, output, or any non-thinking block
              assistantText += evt.content;
            }
          } else if (t === "tool_call_start" || t === "tool_start" || t === "tool_use" || t === "mcp_call" || t === "tool_call" || t === "tool_executing") {
            const name = evt.name || evt.tool?.name || evt.toolName;
            if (name && typeof name === "string") toolCalls.push(name);
          } else if (t === "tool_calls_required") {
            // Anthropic-style: array of {function: {name}} on the payload.
            if (Array.isArray(evt.toolCalls)) {
              for (const tc of evt.toolCalls) {
                const n = tc?.function?.name || tc?.name;
                if (typeof n === "string") toolCalls.push(n);
              }
            }
          } else if (t === "mcp_calls_data") {
            // Round-by-round MCP call data with `calls[].toolName`.
            if (Array.isArray(evt.calls)) {
              for (const c of evt.calls) {
                const n = c?.toolName || c?.name || c?.tool;
                if (typeof n === "string") toolCalls.push(n);
              }
            }
          } else if (t === "cot_step" && evt.step?.type === "tool_call" && evt.step?.status === "completed") {
            const n = evt.step?.request?.name;
            if (typeof n === "string") toolCalls.push(n);
          } else if (t === "message_complete" || t === "message_saved") {
            // Final assistant message often arrives as a full content blob +
            // an mcpCalls array summarizing every tool invoked during the
            // turn. Scan it for tool names so we capture calls that the
            // per-delta stream never announced with tool_call_start events
            // (some providers skip the start event and only emit the
            // aggregated completion payload).
            if (Array.isArray(evt.mcpCalls)) {
              for (const mc of evt.mcpCalls) {
                const n = mc?.name || mc?.toolName || mc?.tool;
                if (typeof n === "string" && !toolCalls.includes(n)) toolCalls.push(n);
              }
            }
            // If the delta stream didn't emit any text blocks but the
            // message_saved payload has a final content string, adopt it
            // as the assistant text so assertions have something to regex.
            if (assistantText.length === 0 && typeof evt.content === "string" && evt.content.length > 0 && evt.role === "assistant") {
              assistantText = evt.content;
            }
          } else if (t === "error" || evt.error) {
            errored = true;
            errorMsg = evt.error?.message || evt.message || "stream error";
          }
        } catch {
          ndjsonLines.push(JSON.stringify({ type: "__unparseable_sse_line", payload: payload.slice(0, 500), pendingEvent }));
        }

        pendingEvent = null;
      }
    }
  } catch (e: any) {
    errored = true;
    errorMsg = e?.name === "AbortError" ? `timeout after ${uc.timeout_s}s` : (e?.message ?? String(e));
  } finally {
    clearTimeout(timer);
  }

  function finish(): RunResult {
    const durationMs = Date.now() - start;
    writeFileSync(rawNdjsonPath, ndjsonLines.join("\n") + (ndjsonLines.length ? "\n" : ""));
    writeFileSync(join(ucDir, "timing.json"), JSON.stringify({
      ttfbMs, totalMs: durationMs, eventCount, byteCount,
    }, null, 2));
    return { assistantText, thinkingText, toolCalls, eventTypes, durationMs, ttfbMs, eventCount, byteCount, rawNdjsonPath, errored, errorMsg };
  }
  return finish();
}

// ---------- assertions ----------
type Assertion = {
  pass: boolean;
  reasons: string[];
  tools_expected: string[];
  tools_found: string[];
  patterns_expected: string[];
  patterns_matched: Record<string, boolean>;
  events_expected: string[];
  events_matched: Record<string, boolean>;
  forbidden_expected: string[];
  forbidden_matched: Record<string, boolean>;
  allow_stream_error: boolean;
  assistantTextSha256: string;
  assistantTextLength: number;
  thinkingTextLength: number;
  ttfbMs: number;
  totalMs: number;
  ts: string;
};

function assess(uc: UC, r: RunResult): Assertion {
  const reasons: string[] = [];
  const allowStreamError = uc.allow_stream_error === true;
  if (r.errored && !allowStreamError) reasons.push(`stream error: ${r.errorMsg}`);
  for (const need of uc.expected_tools) {
    if (!r.toolCalls.includes(need)) reasons.push(`missing tool: ${need}`);
  }
  const matched: Record<string, boolean> = {};
  for (const pat of uc.expected_patterns) {
    try {
      const re = new RegExp(pat, "i");
      const ok = re.test(r.assistantText);
      matched[pat] = ok;
      if (!ok) reasons.push(`pattern not matched: /${pat}/i`);
    } catch (e: any) {
      matched[pat] = false;
      reasons.push(`bad regex /${pat}/: ${e?.message}`);
    }
  }
  const eventsExpected = uc.expected_events ?? [];
  const eventsMatched: Record<string, boolean> = {};
  for (const want of eventsExpected) {
    const seen = r.eventTypes.includes(want);
    eventsMatched[want] = seen;
    if (!seen) reasons.push(`missing event: ${want}`);
  }
  const forbiddenExpected = uc.forbidden_patterns ?? [];
  const forbiddenMatched: Record<string, boolean> = {};
  for (const pat of forbiddenExpected) {
    try {
      const re = new RegExp(pat, "i");
      const hit = re.test(r.assistantText);
      forbiddenMatched[pat] = hit;
      if (hit) reasons.push(`forbidden pattern appeared: /${pat}/i`);
    } catch (e: any) {
      forbiddenMatched[pat] = false;
      reasons.push(`bad forbidden regex /${pat}/: ${e?.message}`);
    }
  }
  return {
    pass: reasons.length === 0,
    reasons,
    tools_expected: uc.expected_tools,
    tools_found: r.toolCalls,
    patterns_expected: uc.expected_patterns,
    patterns_matched: matched,
    events_expected: eventsExpected,
    events_matched: eventsMatched,
    forbidden_expected: forbiddenExpected,
    forbidden_matched: forbiddenMatched,
    allow_stream_error: allowStreamError,
    assistantTextSha256: createHash("sha256").update(r.assistantText).digest("hex"),
    assistantTextLength: r.assistantText.length,
    thinkingTextLength: r.thinkingText.length,
    ttfbMs: r.ttfbMs,
    totalMs: r.durationMs,
    ts: new Date().toISOString(),
  };
}

// ---------- main ----------
async function main() {
  let token = process.env.UC_HARNESS_TOKEN;
  if (!token) {
    const path = resolve(".uc-harness-token");
    if (existsSync(path)) token = readFileSync(path, "utf8").trim();
  }
  if (!token) {
    console.error("[uc-harness] UC_HARNESS_TOKEN not set and .uc-harness-token not found. Run scripts/generate-uc-harness-token.sh first.");
    process.exit(1);
  }

  const base = (process.env.UC_API_BASE ?? "https://chat-dev.openagentic.io").replace(/\/$/, "");

  // args: [yaml-path] [--evidence-dir path]
  const args = process.argv.slice(2);
  let yamlArg: string | null = null;
  let evidenceDir = "docs/releases/0.6.6-evidence";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--evidence-dir") {
      evidenceDir = args[++i];
    } else if (!yamlArg) {
      yamlArg = args[i];
    }
  }
  const yamlPath = resolve(yamlArg ?? join(dirname(import.meta.path), "bob-uc.yaml"));
  const evidenceAbs = resolve(evidenceDir);
  mkdirSync(join(evidenceAbs, "harness-runs"), { recursive: true });

  const src = readFileSync(yamlPath, "utf8");
  const cases = parseYaml(src);
  const runTs = new Date().toISOString().replace(/[:]/g, "-");
  const logPath = join(evidenceAbs, "harness-runs", `${yamlPath.split("/").pop()}.${runTs}.log`);

  const logLines: string[] = [];
  const log = (s: string) => {
    console.log(s);
    logLines.push(s);
  };
  log(`[uc-harness] loaded ${cases.length} case(s) from ${yamlPath}`);
  log(`[uc-harness] base=${base}`);
  log(`[uc-harness] evidence=${evidenceAbs}`);
  log(`[uc-harness] run-ts=${runTs}`);

  const rows: Array<{ id: string; pass: boolean; ms: number; ttfb: number; tools: number; reasons: string[] }> = [];

  for (const uc of cases) {
    process.stdout.write(`  • ${uc.id} ... `);
    let assertion: Assertion;
    let r: RunResult;
    try {
      r = await runChat(base, token, uc, evidenceAbs);
      assertion = assess(uc, r);
    } catch (e: any) {
      log(`FATAL — ${e?.message ?? String(e)}`);
      rows.push({ id: uc.id, pass: false, ms: 0, ttfb: 0, tools: 0, reasons: [`harness fatal: ${e?.message ?? String(e)}`] });
      continue;
    }
    const ucDir = join(evidenceAbs, "uc", uc.id);
    writeFileSync(join(ucDir, "assertions.json"), JSON.stringify(assertion, null, 2));
    rows.push({
      id: uc.id, pass: assertion.pass, ms: r.durationMs, ttfb: r.ttfbMs, tools: r.toolCalls.length, reasons: assertion.reasons,
    });
    log(assertion.pass
      ? `PASS (${r.durationMs}ms, ttfb=${r.ttfbMs}ms, ${r.toolCalls.length} tools, ${assertion.assistantTextLength}c text)`
      : `FAIL (${r.durationMs}ms) — ${assertion.reasons.join("; ")}`);
  }

  const wId = Math.max(4, ...rows.map((x) => x.id.length));
  log("\n" + "id".padEnd(wId) + "  result  ms       ttfb   tools  notes");
  log("-".repeat(wId + 40));
  for (const r of rows) {
    log(
      r.id.padEnd(wId) + "  " +
      (r.pass ? "PASS  " : "FAIL  ") + "  " +
      String(r.ms).padEnd(7) + "  " +
      String(r.ttfb).padEnd(5) + "  " +
      String(r.tools).padEnd(5) + "  " +
      (r.pass ? "" : r.reasons.join("; "))
    );
  }

  const failures = rows.filter((r) => !r.pass).length;
  log(`\n${rows.length - failures}/${rows.length} passed`);
  writeFileSync(logPath, logLines.join("\n") + "\n");
  log(`[uc-harness] log written to ${logPath}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[uc-harness] fatal:", e);
  process.exit(2);
});
