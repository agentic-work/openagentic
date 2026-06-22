/**
 * abortableAxios.ts — B7: Thread AbortController.signal through every axios call
 *
 * Drop-in wrappers around axios.post / axios.get / axios() that inject the
 * execution-scoped AbortSignal into every outbound HTTP request.  When the
 * workflow engine calls abortExecution(), the signal fires and axios cancels
 * any in-flight request within milliseconds — stopping cost accrual for LLM
 * and agent calls immediately.
 *
 * Usage (inside WorkflowExecutionEngine methods):
 *   // before: await axios.post(url, data, config)
 *   // after:  await abortableAxiosPost(this, url, data, config)
 *   //         (engine implements AbortableAxiosContext via its .signal getter)
 *
 * TODO S0-11 / engine-dedup: when the api and workflows engines are merged into
 * a single canonical source, this file and its api-engine copy should be
 * consolidated into a shared package.
 */

import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';

// ---------------------------------------------------------------------------
// Context interface — satisfied by WorkflowExecutionEngine (has a .signal getter)
// ---------------------------------------------------------------------------

export interface AbortableAxiosContext {
  signal: AbortSignal;
}

// ---------------------------------------------------------------------------
// Wrappers
// ---------------------------------------------------------------------------

/**
 * Drop-in for axios.post(url, data, config).
 * The ctx.signal is always injected; any signal in `config` is overridden.
 */
export async function abortableAxiosPost<T = any>(
  ctx: AbortableAxiosContext,
  url: string,
  data?: any,
  config: AxiosRequestConfig = {}
): Promise<AxiosResponse<T>> {
  return axios.post<T>(url, data, { ...config, signal: ctx.signal });
}

/**
 * Drop-in for axios.get(url, config).
 * The ctx.signal is always injected; any signal in `config` is overridden.
 */
export async function abortableAxiosGet<T = any>(
  ctx: AbortableAxiosContext,
  url: string,
  config: AxiosRequestConfig = {}
): Promise<AxiosResponse<T>> {
  return axios.get<T>(url, { ...config, signal: ctx.signal });
}

/**
 * Drop-in for the single-object axios({...}) call style.
 * Delegates to axios.request() and injects the signal.
 */
export async function abortableAxios<T = any>(
  ctx: AbortableAxiosContext,
  config: AxiosRequestConfig
): Promise<AxiosResponse<T>> {
  return axios.request<T>({ ...config, signal: ctx.signal });
}
