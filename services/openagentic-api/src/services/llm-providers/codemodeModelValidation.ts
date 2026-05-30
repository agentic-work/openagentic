export type ValidateCallerModelResult =
  | { ok: true; model: string }
  | ValidateCallerModelError;

export interface ValidateCallerModelError {
  ok: false;
  code: 'model_required' | 'model_not_in_registry' | 'registry_empty';
  message: string;
  available: string[];
}

/** Prisma shape we need for `getValidCodeModels`. Matches the lift from the
 *  now-deleted CodemodeModelOverrideService — this module is the new home for
 *  the registry-read so the override service file can be cleanly deleted.
 *
 *  Cycle 5 (2026-04-26): also reads `system_configuration` to surface
 *  `default_models.code` as an always-valid model. Admin's "Global Codemode
 *  Model" UI writes that value; users hitting it through admin should NEVER
 *  see "model_not_in_registry" for that exact id, even if the role-assignment
 *  table doesn't carry a matching row. */
export interface MinimalPrisma {
  modelRoleAssignment: {
    findMany(args: {
      where: { role: string | { in: string[] }; enabled: boolean };
      select?: { model: boolean; provider?: boolean; priority?: boolean };
    }): Promise<Array<{ model: string; provider?: string | null; priority?: number }>>;
  };
  systemConfiguration?: {
    findFirst(args?: unknown): Promise<{ value?: unknown } | null>;
  };
}

/** Read `default_models.code` from system_configuration. Returns the
 *  trimmed model id, or empty string when missing/malformed.
 *
 *  Schema: row.key = 'default_models', row.value = {chat, code, embedding,
 *  vision, imageGen}. Mirrors the lookup in
 *  services/model-routing/defaultModelsAdmin.ts::getDefaults — that's the
 *  same row the admin "Global Codemode Model" UI writes to via PUT
 *  /api/admin/llm-providers/default-models. */
export async function getDefaultCodeModel(
  prisma: any,
): Promise<string> {
  try {
    const row = await prisma.systemConfiguration?.findUnique?.({
      where: { key: 'default_models' },
    });
    const v = row?.value;
    const code = v?.code;
    return typeof code === 'string' && code.trim().length > 0 ? code.trim() : '';
  } catch {
    return '';
  }
}

/** Discovery source: returns the chat-capable models the provider layer
 *  has discovered in memory (ProviderManager's discoveredCapabilities map
 *  + each provider's listModels()). Used as an ADDITIVE supplement to
 *  the Registry-curated set so day-0 deploys aren't bricked before admin
 *  curates. The legacy provider_config.models[] field is no longer read
 *  here — the Registry table is the SoT. */
export type DiscoverySource = () => Promise<Array<{ id: string; capabilities?: { chat?: boolean } }>>;

/** Load the set of valid code-role model ids.
 *
 *  Sources merged together:
 *    1. `modelRoleAssignment` rows where `role='code'` AND `enabled=true`
 *       — the explicit, admin-curated blessed set.
 *    2. (When a discovery source is provided) chat-capable models from
 *       the in-memory ProviderManager discovery cache + per-provider
 *       listModels(). Filters non-chat (embeddings, image gen) so /model
 *       can't pick a Titan or Imagen by accident.
 *
 *  Discovery is ADDITIVE, not a fallback: a Registry row of gpt-oss:20b
 *  + a discovery list of [gemini-2.5-flash, claude-sonnet-4-6] yields
 *  all three. This matches the user's directive that all configured
 *  providers be reachable via /model X without manually click-Add-Model
 *  for every one. Admins can still LIMIT by setting status=disabled
 *  on a specific provider (drops its discovered models) or by leaving
 *  Registry empty + zero providers (returns []).
 *
 *  Rule compliance with feedback_registry_explicit_add.md:
 *  the Registry TABLE itself is NEVER auto-populated by this function.
 *  This is a read-only validation surface; admin curation continues to
 *  flow through the Add-Model UI on the Registry table.
 *
 *  Discovery failures are swallowed — Registry stays authoritative. */
export async function getValidCodeModels(
  prisma: MinimalPrisma,
  discoverySource?: DiscoverySource,
): Promise<string[]> {
  // 2026-05-05: accept BOTH role='code' and role='chat'. Both roles imply
  // a chat-capable model. Filtering to role='code' alone hid every
  // chat-role registry entry from the codemode /model picker (e.g. AIF's
  // gpt-oss-120b sits under role='chat' yet is fully chat/tool capable
  // and happily serves codemode turns when explicitly selected). The
  // admin-default fallback (down at line ~133) still wins on its own
  // when the registry has zero matching rows.
  const rows = await prisma.modelRoleAssignment.findMany({
    where: { role: { in: ['code', 'chat'] }, enabled: true },
    select: { model: true },
  });
  const registry = rows
    .map((r) => r.model)
    .filter((m): m is string => typeof m === 'string' && m.length > 0);

  let discovered: string[] = [];
  if (discoverySource) {
    try {
      const list = await discoverySource();
      discovered = list
        .filter((m) => m && typeof m.id === 'string' && m.id.length > 0 && m.capabilities?.chat === true)
        .map((m) => m.id);
    } catch {
      discovered = [];
    }
  }

  // Cycle 5: admin's "Global Codemode Model" is always valid. The
  // user's mental model is "I set codemode to X in admin → X works."
  // Without this, users see model_not_in_registry the moment they pick
  // a model that hasn't been separately registered to role=code.
  const adminDefault = await getDefaultCodeModel(prisma);

  return Array.from(
    new Set([...registry, ...discovered, ...(adminDefault ? [adminDefault] : [])]),
  );
}

/** Validate that `model` is a non-empty string present in `validIds`.
 *  Returns either the trimmed valid model id or a structured error
 *  the route handler maps to a 400 response body. */
export function validateCallerModel(
  model: string | undefined | null,
  validIds: string[],
): ValidateCallerModelResult {
  if (!Array.isArray(validIds) || validIds.length === 0) {
    return {
      ok: false,
      code: 'registry_empty',
      message:
        'Codemode Registry has no models registered for role=code. Admin must register at least one model in the admin Models UI before /model can switch.',
      available: [],
    };
  }
  const trimmed = typeof model === 'string' ? model.trim() : '';
  if (!trimmed) {
    return {
      ok: false,
      code: 'model_required',
      message: `Codemode caller did not send a model. Send body.model = one of [${validIds.join(', ')}]. The model is required so /model swaps surface immediately.`,
      available: [...validIds],
    };
  }
  if (!validIds.includes(trimmed)) {
    // Cycle 3 wire-format accommodation: the openagentic daemon canonicalizes
    // upstream Claude ids (e.g. "us.anthropic.claude-sonnet-4-6" → "claude-sonnet-4-6")
    // before sending body.model. Resolve to a full id when there's exactly one
    // substring match in validIds. When us./global. region prefixes both match
    // (Bedrock cross-region inference profiles), prefer `us.` since the
    // helm default + dev cluster are us-east-1. 3+ remaining matches after
    // tiebreaker → reject (genuine admin disambiguation needed).
    const matches = validIds.filter((id) => id.includes(trimmed));
    if (matches.length === 1) {
      return { ok: true, model: matches[0]! };
    }
    if (matches.length > 1) {
      const usPreferred = matches.filter((id) => id.startsWith('us.'));
      if (usPreferred.length === 1) {
        return { ok: true, model: usPreferred[0]! };
      }
    }
    return {
      ok: false,
      code: 'model_not_in_registry',
      message: `Model "${trimmed}" is not registered for role=code. Available: [${validIds.join(', ')}]. Either /model X (with one of those) or have an admin register it via the admin Models UI.`,
      available: [...validIds],
    };
  }
  return { ok: true, model: trimmed };
}

// ---------------------------------------------------------------------------
// resolveCodemodeRouting — Cycle 5b (2026-04-26)
//
// The original Cycle 5 fallback only handled `validation.ok === false`
// (caller model missing or rejected by Registry). Live-cluster evidence on
// 2026-04-26 showed a SECOND failure mode that bypassed the fallback:
//
//   1. caller body.model = "claude-sonnet-4-6"
//   2. validIds includes "claude-sonnet-4-6" via discovery (a Bedrock
//      provider's provider_config.models[] surfaces it as chat-capable)
//      → validation.ok === true
//   3. providerManager.modelToProviderMap was built from a DIFFERENT shape
//      (Registry rows + provider config keys) and does NOT include the
//      discovered claude id → getProviderForModel(...) returns null
//   4. Route returned 400 "No provider available for model" in 19-37ms
//   5. openagentic daemon wrote the 400 as an assistant turn but the
//      relay-WS never propagated; UI showed "Forging…" for 600s.
//
// Symptom in api log was the LAST-line `[Openagentic/v1/messages]
// Anthropic-compatible request received` followed only by
// `POST /v1/messages 400 19ms` and `Cannot write headers after they are
// sent to the client` — neither the Cycle-5 warn log nor the no-provider
// 400 message logged because both branches sent 400 without a preceding
// `loggers.routes.warn` AND used `reply.code(...).send(...)` without
// await (Fastify v5 unawaited-send bug fires the global onSend hook
// after the response is finalized → ERR_HTTP_HEADERS_SENT).
//
// Fix: a unified resolver that ALWAYS prefers the admin default when
// either validation rejects OR provider mapping fails. The admin default
// is the user-visible SoT for codemode ("Global Codemode Model" in admin),
// so it wins over a discovery-stale model id every time.
// ---------------------------------------------------------------------------

export type ResolveCodemodeRoutingResult =
  | {
      ok: true;
      effectiveModel: string;
      providerName: string;
      // Reason the resolver took the admin-default path. `null` when the
      // caller's model resolved cleanly. Set so callers (the route handler)
      // can log a warning indicating why fallback fired.
      fallbackReason: null | 'validation_failed' | 'no_provider_for_model';
      // The original validation outcome, surfaced for telemetry.
      validation: ValidateCallerModelResult;
    }
  | {
      ok: false;
      // 400-shaped error the route maps to a JSON error body. Only
      // returned when there is NO admin default at all (genuine
      // misconfiguration) — otherwise we always fall through to the
      // admin default and return ok:true.
      status: 400;
      body: {
        type: 'error';
        error: {
          type: 'invalid_request_error';
          code: ValidateCallerModelError['code'] | 'no_provider_for_model';
          message: string;
          available: string[];
        };
      };
    };

/** Resolve a caller's body.model into a concrete (effectiveModel, providerName)
 *  pair, or a 400 error body, in a way that gracefully falls back to the
 *  admin's "Global Codemode Model" SoT whenever the caller's pin doesn't
 *  resolve.
 *
 *  Pure logic — caller injects:
 *    • `validIds` — pre-loaded valid model list (from getValidCodeModels)
 *    • `getProviderForModel` — providerManager's lookup
 *    • `resolveAlias` — providerManager's alias resolver
 *    • `adminDefaultModel` — the admin's "Global Codemode Model" (may be empty)
 *
 *  Returning a structured result keeps the route handler trivial and lets
 *  vitest exercise every branch without a Fastify instance.
 */
export function resolveCodemodeRouting(args: {
  callerModel: string | undefined | null;
  validIds: string[];
  resolveAlias: (model: string) => string;
  getProviderForModel: (model: string) => string | null | undefined;
  adminDefaultModel: string;
}): ResolveCodemodeRoutingResult {
  const { callerModel, validIds, resolveAlias, getProviderForModel, adminDefaultModel } = args;
  const validation = validateCallerModel(callerModel, validIds);

  // Helper: when fallback fires, validate the admin default has a provider.
  // If even the admin default has no provider, we have a real misconfig
  // and surface a 400 (rather than silently 500-ing in the stream loop).
  const adminFallback = (
    fallbackReason: 'validation_failed' | 'no_provider_for_model',
    err400Code: ValidateCallerModelError['code'] | 'no_provider_for_model',
    err400Message: string,
  ): ResolveCodemodeRoutingResult => {
    if (!adminDefaultModel) {
      return {
        ok: false,
        status: 400,
        body: {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            code: err400Code,
            message: err400Message,
            available: [...validIds],
          },
        },
      };
    }
    const adminAlias = resolveAlias(adminDefaultModel);
    const adminProvider = getProviderForModel(adminAlias);
    if (!adminProvider) {
      // Genuine misconfig — admin set "default_models.code" to a model
      // no provider can serve. Don't infinite-loop; return 400 with a
      // clear message so the admin sees the problem in the UI.
      return {
        ok: false,
        status: 400,
        body: {
          type: 'error',
          error: {
            type: 'invalid_request_error',
            code: 'no_provider_for_model',
            message: `Admin default codemode model "${adminDefaultModel}" has no provider. Please pick a different model under Admin → Models → Global Codemode Model.`,
            available: [...validIds],
          },
        },
      };
    }
    return {
      ok: true,
      effectiveModel: adminAlias,
      providerName: adminProvider,
      fallbackReason,
      validation,
    };
  };

  if (validation.ok === false) {
    return adminFallback('validation_failed', validation.code, validation.message);
  }

  const callerAlias = resolveAlias(validation.model);
  const callerProvider = getProviderForModel(callerAlias);
  if (!callerProvider) {
    return adminFallback(
      'no_provider_for_model',
      'no_provider_for_model',
      `No provider available for model: ${callerAlias}`,
    );
  }

  return {
    ok: true,
    effectiveModel: callerAlias,
    providerName: callerProvider,
    fallbackReason: null,
    validation,
  };
}
