/**
 * detectOutputType — n8n/Langflow-style routing of node execution outputs
 * to the appropriate renderer in ExecutionResultsPanel.
 *
 * Returns one of:
 *   - 'html'      → SafeHtmlIframe (sandboxed CSP-nonce iframe)
 *   - 'markdown'  → SharedMarkdownRenderer
 *   - 'image'     → <img> with data: / https: src
 *   - 'table'     → DataTable (rows × cols)
 *   - 'text'      → <pre><code>
 *   - 'json'      → CollapsibleJsonTree (default fallback)
 *
 * Drives the "Rendered" view of the right-side output panel so that
 * webhook_response nodes show their HTML report inline (not as a
 * quoted JSON string), LLM nodes show formatted prose, etc.
 *
 * Spec context:
 *   - flows-real-output-rendering/2026-05-14 — user complaint that the
 *     "Rendered" toggle was rendering a JSON tree of the body string
 *     instead of the actual rendered HTML / markdown.
 */

export type RenderedOutputType =
  | 'html'
  | 'markdown'
  | 'json'
  | 'table'
  | 'image'
  | 'text';

const LLM_NODE_TYPES = new Set([
  'llm_completion',
  'openagentic_llm',
  'multi_agent',
  'agent_single',
  'agent_pool',
  'agent_supervisor',
  'agent_spawn',
  'a2a',
  'synth',
  'reasoning',
  'structured_output',
  'llm',
]);

const HTML_PREFIX_RE = /^\s*(?:<!doctype html|<html\b|<body\b|<div\b|<p\b|<table\b|<section\b|<article\b|<header\b|<main\b|<style\b|<svg\b|<ul\b|<ol\b|<h[1-6]\b)/i;

const IMAGE_URL_RE = /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)(?:\?.*)?$/i;
const IMAGE_DATA_URL_RE = /^data:image\//i;

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function looksLikeHtml(s: string): boolean {
  if (!isString(s) || s.length < 20) return false;
  return HTML_PREFIX_RE.test(s.trim());
}

function looksLikeMarkdown(s: string): boolean {
  if (!isString(s) || s.length < 2) return false;
  const t = s.trim();
  // Strong markers — # heading lines, ## subheaders, **bold**, ```fence
  if (/^#{1,6}\s+\S/m.test(t)) return true;
  if (/\n#{1,6}\s+\S/.test(t)) return true;
  if (/\*\*[^*]+\*\*/.test(t)) return true;
  if (/^```/m.test(t)) return true;
  if (/^[-*]\s+\S/m.test(t) && /\n/.test(t)) return true;
  if (/^>\s+\S/m.test(t)) return true;
  return false;
}

function looksLikeImage(out: any): boolean {
  if (!out || typeof out !== 'object') return false;
  if (isString(out.dataUrl) && IMAGE_DATA_URL_RE.test(out.dataUrl)) return true;
  if (isString(out.url) && (IMAGE_URL_RE.test(out.url) || IMAGE_DATA_URL_RE.test(out.url))) return true;
  if (isString(out.src) && (IMAGE_URL_RE.test(out.src) || IMAGE_DATA_URL_RE.test(out.src))) return true;
  const ct = out?.headers?.['content-type'] ?? out?.headers?.['Content-Type'];
  if (isString(ct) && ct.toLowerCase().startsWith('image/')) return true;
  return false;
}

function looksLikeTable(out: any): boolean {
  let rows: any[] | null = null;
  if (Array.isArray(out)) rows = out;
  else if (out && typeof out === 'object') {
    if (Array.isArray((out as any).rows)) rows = (out as any).rows;
    else if (Array.isArray((out as any).data)) rows = (out as any).data;
    else if (Array.isArray((out as any).items)) rows = (out as any).items;
    else if (Array.isArray((out as any).results)) rows = (out as any).results;
  }
  if (!rows || rows.length < 2) return false;
  // Each row must be a plain object with ≥2 keys, and ≥half the rows
  // must share at least one common key (loosely consistent shape).
  const first = rows[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return false;
  const keys = Object.keys(first);
  if (keys.length < 2) return false;
  let matches = 0;
  for (const r of rows) {
    if (r && typeof r === 'object' && !Array.isArray(r)) {
      const rk = Object.keys(r);
      if (rk.length >= 2 && keys.some(k => k in r)) matches++;
    }
  }
  return matches >= Math.ceil(rows.length / 2);
}

/**
 * detectOutputType — pick the renderer for a node's output.
 */
export function detectOutputType(nodeType: string, output: unknown): RenderedOutputType {
  // Envelope short-circuits — these are explicit format declarations
  if (output && typeof output === 'object' && 'format' in (output as any) && 'content' in (output as any)) {
    const fmt = (output as any).format;
    if (fmt === 'html') return 'html';
    if (fmt === 'markdown') return 'markdown';
    if (fmt === 'table') return 'table';
    if (fmt === 'json') return 'json';
  }

  // String at the top level
  if (isString(output)) {
    if (looksLikeHtml(output)) return 'html';
    if (looksLikeMarkdown(output)) return 'markdown';
    return 'text';
  }

  if (output === null || output === undefined) return 'json';

  if (typeof output !== 'object') return 'text';

  // Image detection (data URL, content-type, file extension)
  if (looksLikeImage(output)) return 'image';

  // Webhook response body — primary case from the user report
  if (nodeType === 'webhook_response' || nodeType === 'http_request') {
    const body = (output as any).body;
    if (isString(body) && looksLikeHtml(body)) return 'html';
    if (isString(body) && looksLikeMarkdown(body)) return 'markdown';
    // JSON / structured body falls through to json default
  }

  // Code nodes — stdout text
  if (nodeType === 'code') {
    const stdout = (output as any).stdout;
    if (isString(stdout)) {
      if (looksLikeMarkdown(stdout)) return 'markdown';
      return 'text';
    }
  }

  // LLM nodes — content / text / message
  if (LLM_NODE_TYPES.has(nodeType)) {
    const content = (output as any).content ?? (output as any).text ?? (output as any).message;
    if (isString(content)) {
      if (looksLikeHtml(content)) return 'html';
      if (looksLikeMarkdown(content)) return 'markdown';
      return 'text';
    }
  }

  // Tables — arrays of objects, mcp_tool / rag_query / data_source_query
  if (looksLikeTable(output)) return 'table';

  return 'json';
}

/**
 * extractRenderable — given the detected type, return the inner string
 * (or value) that the renderer should receive. Lets callers do:
 *
 *     const t = detectOutputType(type, out);
 *     if (t === 'html') <SafeHtmlIframe content={extractRenderable(type, out, 'html')} />
 */
export function extractRenderable(
  nodeType: string,
  output: unknown,
  type: RenderedOutputType,
): any {
  if (output === null || output === undefined) return output;

  // Envelope
  if (typeof output === 'object' && 'format' in (output as any) && 'content' in (output as any)) {
    return (output as any).content;
  }

  if (type === 'html' || type === 'markdown' || type === 'text') {
    if (isString(output)) return output;
    const o = output as any;
    if (nodeType === 'webhook_response' || nodeType === 'http_request') {
      if (isString(o.body)) return o.body;
    }
    if (LLM_NODE_TYPES.has(nodeType)) {
      if (isString(o.content)) return o.content;
      if (isString(o.text)) return o.text;
      if (isString(o.message)) return o.message;
    }
    if (nodeType === 'code') {
      if (isString(o.stdout)) return o.stdout;
    }
    // last resort: stringify
    return typeof output === 'string' ? output : String(output);
  }

  if (type === 'image') {
    const o = output as any;
    return o.url ?? o.dataUrl ?? o.src ?? null;
  }

  if (type === 'table') {
    if (Array.isArray(output)) return output;
    const o = output as any;
    return o.rows ?? o.data ?? o.items ?? o.results ?? output;
  }

  // json / fallback — caller renders the raw value
  return output;
}
