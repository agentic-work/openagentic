#!/usr/bin/env bun
/**
 * Bob UC harness runner.
 *
 * Usage:
 *   UC_HARNESS_TOKEN=<jwt> bun testing/uc-harness/run-uc.ts [yaml-path]
 *
 * Env:
 *   UC_HARNESS_TOKEN   required; Bearer JWT for /api/chat/stream
 *   UC_API_BASE        default https://chat-dev.openagentic.io
 *
 * No npm deps. Native fetch only. Tiny hand-rolled YAML parser sufficient
 * for the restricted shape used in bob-uc.yaml (see schema in that file).
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type UC = {
  id: string;
  prompt: string;
  expected_tools: string[];
  expected_patterns: string[];
  timeout_s: number;
  model?: string;
};

// ---------- tiny yaml (list-of-maps only) ----------
function parseYaml(src: string): UC[] {
  const out: UC[] = [];
  const lines = src.split(/\r?\n/);
  let cur: any = null;
  let listKey: string | null = null;

  const flush = () => {
    if (!cur) return;
    cur.expected_tools = cur.expected_tools ?? [];
    cur.expected_patterns = cur.expected_patterns ?? [];
    cur.timeout_s = Number(cur.timeout_s ?? 120);
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

    // new list item: "- id: xxx" or "-"
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

    // indented sub-list element: "    - value"
    const subItem = line.match(/^\s+-\s+(.*)$/);
    if (subItem && cur && listKey) {
      cur[listKey] = cur[listKey] ?? [];
      cur[listKey].push(unquote(subItem[1]));
      continue;
    }

    // indented key: "  key: value" or "  key:"
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

// ---------- SSE chat call ----------
type RunResult = {
  assistantText: string;
  toolCalls: string[];
  durationMs: number;
  errored: boolean;
  errorMsg?: string;
};

async function runChat(base: string, token: string, uc: UC): Promise<RunResult> {
  const sessionId = `uc-harness-${uc.id.toLowerCase()}-${Date.now()}`;
  const body: any = { message: uc.prompt, sessionId };
  if (uc.model) body.model = uc.model;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), uc.timeout_s * 1000);
  const start = Date.now();

  let assistantText = "";
  const toolCalls: string[] = [];
  let errored = false;
  let errorMsg: string | undefined;

  try {
    const resp = await fetch(`${base}/api/chat/stream`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!resp.ok || !resp.body) {
      errored = true;
      errorMsg = `HTTP ${resp.status}`;
      return { assistantText, toolCalls, durationMs: Date.now() - start, errored, errorMsg };
    }

    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload);
          const t = evt.type || evt.event;
          if (t === "content_block_delta" && typeof evt.content === "string") {
            assistantText += evt.content;
          } else if (t === "tool_call_start" || t === "tool_start") {
            if (evt.name) toolCalls.push(evt.name);
            else if (evt.tool?.name) toolCalls.push(evt.tool.name);
          } else if (t === "error" || evt.error) {
            errored = true;
            errorMsg = evt.error?.message || evt.message || "stream error";
          }
        } catch {
          // ignore non-JSON SSE lines
        }
      }
    }
  } catch (e: any) {
    errored = true;
    errorMsg = e?.name === "AbortError" ? `timeout after ${uc.timeout_s}s` : (e?.message ?? String(e));
  } finally {
    clearTimeout(timer);
  }

  return { assistantText, toolCalls, durationMs: Date.now() - start, errored, errorMsg };
}

// ---------- assertions ----------
function assess(uc: UC, r: RunResult): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (r.errored) reasons.push(`stream error: ${r.errorMsg}`);
  for (const need of uc.expected_tools) {
    if (!r.toolCalls.includes(need)) reasons.push(`missing tool: ${need}`);
  }
  for (const pat of uc.expected_patterns) {
    try {
      const re = new RegExp(pat, "i");
      if (!re.test(r.assistantText)) reasons.push(`pattern not matched: /${pat}/i`);
    } catch (e: any) {
      reasons.push(`bad regex /${pat}/: ${e?.message}`);
    }
  }
  return { pass: reasons.length === 0, reasons };
}

// ---------- main ----------
async function main() {
  const token = process.env.UC_HARNESS_TOKEN;
  const base = (process.env.UC_API_BASE ?? "https://chat-dev.openagentic.io").replace(/\/$/, "");
  const yamlPath = resolve(process.argv[2] ?? `${import.meta.dir}/bob-uc.yaml`);

  if (!token) {
    console.log(`[uc-harness] UC_HARNESS_TOKEN not set; skipping (exit 0).`);
    process.exit(0);
  }

  const src = readFileSync(yamlPath, "utf8");
  const cases = parseYaml(src);
  console.log(`[uc-harness] loaded ${cases.length} case(s) from ${yamlPath}`);
  console.log(`[uc-harness] base=${base}`);

  const rows: Array<{ id: string; pass: boolean; ms: number; reasons: string[]; tools: number }> = [];

  for (const uc of cases) {
    process.stdout.write(`  • ${uc.id} ... `);
    const r = await runChat(base, token, uc);
    const { pass, reasons } = assess(uc, r);
    rows.push({ id: uc.id, pass, ms: r.durationMs, reasons, tools: r.toolCalls.length });
    console.log(pass ? `PASS (${r.durationMs}ms, ${r.toolCalls.length} tools)`
                     : `FAIL (${r.durationMs}ms) — ${reasons.join("; ")}`);
  }

  // table
  const wId = Math.max(4, ...rows.map((x) => x.id.length));
  console.log("\n" + "id".padEnd(wId) + "  result  ms       tools  notes");
  console.log("-".repeat(wId + 32));
  for (const r of rows) {
    console.log(
      r.id.padEnd(wId) + "  " +
      (r.pass ? "PASS  " : "FAIL  ") + "  " +
      String(r.ms).padEnd(7) + "  " +
      String(r.tools).padEnd(5) + "  " +
      (r.pass ? "" : r.reasons.join("; "))
    );
  }

  const failures = rows.filter((r) => !r.pass).length;
  console.log(`\n${rows.length - failures}/${rows.length} passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("[uc-harness] fatal:", e);
  process.exit(2);
});
