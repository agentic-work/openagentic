export type SlashInterceptResult =
  | { kind: 'picker'; picker: 'skills' | 'mcp' | 'plugins' | 'model' | 'agents' }
  | {
      kind: 'control_request';
      subtype: 'reload_plugins' | 'compact' | 'get_context_usage';
      args?: string;
    }
  | { kind: 'forward' };

/**
 * Classify a trimmed user input. Caller is responsible for trimming
 * before calling — the helper does NOT re-trim or mutate input. Empty
 * string returns 'forward' (caller short-circuits empty input upstream).
 */
export function classifySlashInput(trimmed: string): SlashInterceptResult {
  // Native React pickers — match these first because some (/plugins) are
  // a superset of the control_request commands and we want pickers to win
  // when the user just types `/plugin` without a subcommand.
  if (/^\/skills(\s+.*)?$/i.test(trimmed)) {
    return { kind: 'picker', picker: 'skills' };
  }
  if (/^\/plugins?(\s+.*)?$/i.test(trimmed)) {
    return { kind: 'picker', picker: 'plugins' };
  }
  if (/^\/model(\s+.*)?$/i.test(trimmed)) {
    return { kind: 'picker', picker: 'model' };
  }
  if (/^\/mcp(\s+.*)?$/i.test(trimmed)) {
    return { kind: 'picker', picker: 'mcp' };
  }
  if (/^\/agents(\s+.*)?$/i.test(trimmed)) {
    return { kind: 'picker', picker: 'agents' };
  }

  // Control-request bridges — these slash commands have working daemon
  // handlers but no `supportsNonInteractive: true` flag, so the daemon's
  // headlessSlashDispatch can't run them through the slash path. Sending
  // them as user prompts forwards to the LLM (hallucinated reply).
  // Instead the UI maps them onto the daemon's existing control_request
  // surface — no LLM round-trip, no placeholder text.
  //
  // /reload-plugins → daemon's `reload_plugins` control_request handler
  // (see openagentic/src/cli/print.ts:3167). Returns commands/agents/
  // plugins/mcpServers payload via control_response. The hook surfaces a
  // confirmation system message immediately on dispatch so the user sees
  // the action took.
  if (/^\/reload-plugins(\s+.*)?$/i.test(trimmed)) {
    return { kind: 'control_request', subtype: 'reload_plugins' };
  }

  // /compact [optional instructions] → daemon's `compact` control_request
  // handler. The args (if any) become custom summarisation instructions
  // for compactConversation. The daemon emits a system/compact_boundary
  // event when the compaction lands, which the streamReducer flashes via
  // the existing compactionFlash animation; the control_response carries
  // a userDisplayMessage we surface as a system row.
  const compactMatch = trimmed.match(/^\/compact(?:\s+(.*))?$/i);
  if (compactMatch) {
    const args = compactMatch[1]?.trim();
    return {
      kind: 'control_request',
      subtype: 'compact',
      ...(args && args.length > 0 ? { args } : {}),
    };
  }

  // /context → daemon's `get_context_usage` control_request handler
  // (openagentic/src/cli/print.ts:3063). Returns the same ContextData
  // shape as the interactive /context command — totalTokens,
  // rawMaxTokens, percentage, model, plus per-category breakdowns
  // (mcpTools, agents, skills, memoryFiles).
  //
  // Background (audit 2026-05-04 T38): the headless slash dispatcher
  // calls context-noninteractive.call with a stub ToolUseContext that's
  // missing messages/tools/agentDefinitions. The handler detects the
  // stub shape and returns "Context inspection unavailable in this
  // session". The control_request path runs INSIDE the openagentic
  // child's live query loop where the real state is available.
  if (/^\/context(\s+.*)?$/i.test(trimmed)) {
    return { kind: 'control_request', subtype: 'get_context_usage' };
  }

  return { kind: 'forward' };
}
