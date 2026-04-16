/**
 * Model sync — same-tab CustomEvent + cross-tab BroadcastChannel bridge so the
 * chat input model selector stays in sync with admin console CRUD on models.
 *
 * WHY: ChatContainer fetches /chat/models once on mount. If an admin adds,
 * removes, edits, or toggles a model in the Admin Console (Model Registry /
 * LLM Providers / Model Garden), the chat dropdown silently keeps the stale
 * list until hard-refresh. SEV0: fixed 2026-04-08.
 *
 * USAGE:
 *   import { emitModelsChanged, onModelsChanged } from '@/utils/modelSync';
 *
 *   // Admin side (after any successful model CRUD):
 *   emitModelsChanged('add' | 'delete' | 'toggle' | 'edit' | 'refresh');
 *
 *   // Chat side (subscribe once on mount):
 *   useEffect(() => {
 *     const unsub = onModelsChanged(() => fetchModelsAndPrompt());
 *     return unsub;
 *   }, []);
 */

const EVENT_NAME = 'openagentic:models-changed';
const CHANNEL_NAME = 'openagentic:models';

let channel: BroadcastChannel | null = null;
try {
  if (typeof BroadcastChannel !== 'undefined') {
    channel = new BroadcastChannel(CHANNEL_NAME);
  }
} catch {
  // BroadcastChannel unavailable (old browser, SSR) — same-tab events still work
  channel = null;
}

export type ModelChangeReason =
  | 'add'
  | 'delete'
  | 'toggle'
  | 'edit'
  | 'refresh'
  | 'provider-change'
  | 'unknown';

export function emitModelsChanged(reason: ModelChangeReason = 'unknown'): void {
  // Same-tab listeners (the tab that triggered the change)
  try {
    window.dispatchEvent(
      new CustomEvent(EVENT_NAME, { detail: { reason, ts: Date.now() } })
    );
  } catch {
    /* non-browser env */
  }

  // Cross-tab listeners (user has admin in one tab, chat in another)
  try {
    channel?.postMessage({ type: 'models-changed', reason, ts: Date.now() });
  } catch {
    /* channel closed */
  }
}

export function onModelsChanged(
  handler: (reason: ModelChangeReason) => void
): () => void {
  const sameTabHandler = (e: Event) => {
    const reason = (e as CustomEvent).detail?.reason as ModelChangeReason | undefined;
    handler(reason ?? 'unknown');
  };
  const crossTabHandler = (e: MessageEvent) => {
    if (e.data?.type === 'models-changed') {
      handler((e.data.reason as ModelChangeReason) ?? 'unknown');
    }
  };

  window.addEventListener(EVENT_NAME, sameTabHandler);
  channel?.addEventListener('message', crossTabHandler);

  return () => {
    window.removeEventListener(EVENT_NAME, sameTabHandler);
    channel?.removeEventListener('message', crossTabHandler);
  };
}
