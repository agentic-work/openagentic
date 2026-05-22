/**
 * TDD — codemode model validation (Cycle 1 of model-switch redesign).
 *
 * Spec: docs/superpowers/specs/2026-04-25-codemode-model-switch-redesign.md
 *
 * The new contract: the caller (openagentic daemon) sends `model: X` in
 * /v1/messages body. The server validates X against the Registry
 * (modelRoleAssignment role=code, enabled=true). Valid → use it. Invalid
 * → 400 with helpful list. Missing → 400 with helpful list (forces
 * client to be explicit; surfaces wiring bugs early).
 *
 * No Redis, no override sidecar, no per-turn admin-default lookup.
 * The admin default is a SEPARATE concern read at session-spawn by
 * code-manager and injected as OPENAGENTIC_BOOT_MODEL env into the pod.
 */
import { describe, it, expect } from 'vitest';
import {
  validateCallerModel,
  getValidCodeModels,
  type ValidateCallerModelError,
} from '../codemodeModelValidation.js';

describe('validateCallerModel — Cycle 1 of model-switch redesign', () => {
  const VALID = ['us.anthropic.claude-sonnet-4-6', 'gemini-2.5-flash', 'gpt-oss:20b', 'gpt-5.3-codex'];

  it('returns the model when it is in the valid list', () => {
    const result = validateCallerModel('us.anthropic.claude-sonnet-4-6', VALID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.model).toBe('us.anthropic.claude-sonnet-4-6');
    }
  });

  it('rejects with code=model_not_in_registry when the model is unknown', () => {
    const result = validateCallerModel('definitely-not-real-model', VALID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('model_not_in_registry');
      expect(result.available).toEqual(VALID);
      expect(result.message).toContain('definitely-not-real-model');
      expect(result.message).toContain('not registered');
    }
  });

  it('rejects with code=model_required when the model is missing', () => {
    const cases: Array<string | undefined | null> = [undefined, null, '', '   '];
    for (const m of cases) {
      const result = validateCallerModel(m as string | undefined, VALID);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('model_required');
        expect(result.available).toEqual(VALID);
        expect(result.message).toContain('required');
      }
    }
  });

  it('rejects with code=registry_empty when no valid models exist (admin needs to register at least one)', () => {
    const result = validateCallerModel('anything', []);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('registry_empty');
      expect(result.message).toContain('no models');
    }
  });

  it('trims whitespace before comparing — caller may pass "  X  "', () => {
    const result = validateCallerModel('  us.anthropic.claude-sonnet-4-6  ', VALID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.model).toBe('us.anthropic.claude-sonnet-4-6');
    }
  });

  it('error result type is exhaustive', () => {
    // type-level: TS should require all known codes to be in the union
    const e: ValidateCallerModelError = {
      ok: false,
      code: 'model_required',
      message: 'x',
      available: [],
    };
    expect(e.ok).toBe(false);
  });
});

describe('getValidCodeModels — Registry-empty discovery fallback (#303 / #374)', () => {
  // Spec: openagentic:docs/superpowers/specs/2026-04-25-codemode-model-switch-redesign.md
  //
  // When the modelRoleAssignment table has zero rows for role=code,
  // fall back to the chat-capable models discovered from
  // provider_config.models[]. This is rule-compliant with
  // feedback_registry_explicit_add.md because:
  //   1. Discovery does NOT auto-populate the Registry table.
  //   2. Validation accepts discovered models ONLY when the Registry
  //      is empty (= admin hasn't curated yet).
  //   3. Once admin registers any role=code row, Registry takes over
  //      and the fallback is silent.
  // This unblocks the 4-pin matrix on day-0 deploys without forcing
  // every operator to manually click Add Model 4 times before any
  // codemode call works.
  //
  // We TDD by exercising getValidCodeModels with an injected
  // discovery source (provider_config.models[]).

  function fakePrisma(rows: Array<{ model: string }>) {
    return { modelRoleAssignment: { findMany: async () => rows } };
  }

  function fakeProviderConfigSource(models: Array<{ id: string; capabilities?: { chat?: boolean } }>) {
    return async () => models;
  }

  it('merges Registry rows with chat-capable discovered models when both are present', async () => {
    const result = await getValidCodeModels(
      fakePrisma([{ model: 'gpt-oss:20b' }]),
      fakeProviderConfigSource([
        { id: 'gemini-2.5-flash', capabilities: { chat: true } },
        { id: 'us.anthropic.claude-sonnet-4-6', capabilities: { chat: true } },
      ]),
    );
    expect(result.sort()).toEqual([
      'gemini-2.5-flash',
      'gpt-oss:20b',
      'us.anthropic.claude-sonnet-4-6',
    ]);
  });

  it('falls back to chat-capable discovered models when Registry is empty', async () => {
    const result = await getValidCodeModels(
      fakePrisma([]),
      fakeProviderConfigSource([
        { id: 'gemini-2.5-flash', capabilities: { chat: true } },
        { id: 'us.anthropic.claude-sonnet-4-6', capabilities: { chat: true } },
        { id: 'amazon.titan-embed-text-v2:0', capabilities: { chat: false } }, // embedding-only — must filter out
        { id: 'imagen-4.0', capabilities: {} }, // unknown caps — exclude
      ]),
    );
    expect(result.sort()).toEqual(['gemini-2.5-flash', 'us.anthropic.claude-sonnet-4-6']);
  });

  it('returns empty when Registry empty AND no discovery source provided', async () => {
    const result = await getValidCodeModels(fakePrisma([]));
    expect(result).toEqual([]);
  });

  it('dedupes identical model ids across discovery providers', async () => {
    const result = await getValidCodeModels(
      fakePrisma([]),
      fakeProviderConfigSource([
        { id: 'gpt-oss:20b', capabilities: { chat: true } },
        { id: 'gpt-oss:20b', capabilities: { chat: true } }, // duplicate from a 2nd Ollama host
      ]),
    );
    expect(result).toEqual(['gpt-oss:20b']);
  });

  it('treats discovery-source rejection as Registry-empty (graceful degradation)', async () => {
    const throwingSource = async () => {
      throw new Error('discovery temporarily unavailable');
    };
    const result = await getValidCodeModels(fakePrisma([]), throwingSource);
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2026-05-05: /model picker missing chat-role models
//
// Repro: registry has gpt-5.4 + gpt-oss-120b both at role='chat'.
// /v1/models filters role='code' only → picker shows just gpt-5.4 (the
// admin default) because the chat-role rows get dropped before the
// discovery fallback even kicks in. Codemode users couldn't switch to
// the second AIF model despite it being enabled, chat-capable, and
// already used by the consumer chat surface.
//
// Fix: broaden the filter to accept role IN ('code', 'chat'). Both roles
// imply a chat-capable model. role='embeddings' / 'imageGeneration'
// stay excluded.
// ---------------------------------------------------------------------------

describe('getValidCodeModels — accept role IN (code, chat) (2026-05-05 picker fix)', () => {
  // Filtering-aware fake prisma: honors `where.role` and `where.enabled`
  // so we can pin the production query shape.
  function filteringPrisma(rows: Array<{ model: string; role: string; enabled?: boolean }>) {
    return {
      modelRoleAssignment: {
        findMany: async (args?: any) => {
          const where = args?.where ?? {};
          return rows
            .filter((r) => {
              if (where.enabled !== undefined && (r.enabled ?? true) !== where.enabled) return false;
              if (where.role) {
                if (typeof where.role === 'string' && r.role !== where.role) return false;
                if (where.role.in && !where.role.in.includes(r.role)) return false;
              }
              return true;
            })
            .map((r) => ({ model: r.model }));
        },
      },
    };
  }

  it('returns BOTH role=code and role=chat enabled rows (the gpt-oss-120b case)', async () => {
    const result = await getValidCodeModels(
      filteringPrisma([
        { model: 'gpt-5.4', role: 'chat', enabled: true },
        { model: 'gpt-oss-120b', role: 'chat', enabled: true },
        { model: 'text-embedding-3-large', role: 'embeddings', enabled: true },
      ]),
    );
    // Both chat-capable models surface; embedding model is excluded.
    expect(result.sort()).toEqual(['gpt-5.4', 'gpt-oss-120b']);
  });

  it('still returns role=code rows when present (back-compat)', async () => {
    const result = await getValidCodeModels(
      filteringPrisma([
        { model: 'claude-sonnet-4-6', role: 'code', enabled: true },
        { model: 'gpt-oss:20b', role: 'chat', enabled: true },
      ]),
    );
    expect(result.sort()).toEqual(['claude-sonnet-4-6', 'gpt-oss:20b']);
  });

  it('excludes disabled rows even when the role would qualify', async () => {
    const result = await getValidCodeModels(
      filteringPrisma([
        { model: 'gpt-5.4', role: 'chat', enabled: true },
        { model: 'mistral-large', role: 'chat', enabled: false },
      ]),
    );
    expect(result).toEqual(['gpt-5.4']);
  });

  it('excludes embedding/image roles even when enabled', async () => {
    const result = await getValidCodeModels(
      filteringPrisma([
        { model: 'text-embedding-3-large', role: 'embeddings', enabled: true },
        { model: 'imagen-4.0', role: 'imageGeneration', enabled: true },
      ]),
    );
    expect(result).toEqual([]);
  });
});

describe('validateCallerModel — canonical short-form resolution (Cycle 3 wire-format follow-up)', () => {
  // The openagentic daemon canonicalizes Bedrock/etc. ids to upstream Claude
  // short form before sending body.model on /v1/messages — e.g. it sends
  // "claude-sonnet-4-6" instead of "us.anthropic.claude-sonnet-4-6".
  // Live evidence at chat-dev.openagentic.io 18:23 UTC (api log):
  //   requestedModel: "claude-sonnet-4-6"
  //   code: "model_not_in_registry"
  //   available: [..., "us.anthropic.claude-sonnet-4-6", ...]
  // The model IS available; the daemon's id format diverges. Fix the
  // mismatch on the server side by resolving short forms to full ids
  // when there's a unique substring match. This is a server-side accommodation
  // for the daemon's canonicalization, not a substitute for a daemon-side fix.

  const FULL_BEDROCK = 'us.anthropic.claude-sonnet-4-6';
  const SHORT_FORM = 'claude-sonnet-4-6';

  it('accepts short canonical form when full id is in the valid list', () => {
    const result = validateCallerModel(SHORT_FORM, [FULL_BEDROCK, 'gpt-oss:20b']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Resolved to the FULL id — that's what providerManager understands.
      expect(result.model).toBe(FULL_BEDROCK);
    }
  });

  it('still accepts the full id verbatim (no regression)', () => {
    const result = validateCallerModel(FULL_BEDROCK, [FULL_BEDROCK, 'gpt-oss:20b']);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.model).toBe(FULL_BEDROCK);
  });

  it('on us./global. ambiguity prefers us. (matches helm default + dev cluster region)', () => {
    const result = validateCallerModel(SHORT_FORM, [
      'global.anthropic.claude-sonnet-4-6',
      'us.anthropic.claude-sonnet-4-6',
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.model).toBe('us.anthropic.claude-sonnet-4-6');
  });

  it('us./global. preference is order-independent', () => {
    // Same input, reversed validIds order — still picks us. variant.
    const result = validateCallerModel(SHORT_FORM, [
      'us.anthropic.claude-sonnet-4-6',
      'global.anthropic.claude-sonnet-4-6',
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.model).toBe('us.anthropic.claude-sonnet-4-6');
  });

  it('still rejects when 3+ matches and tiebreaker doesn\'t resolve', () => {
    const result = validateCallerModel('claude-sonnet', [
      'us.anthropic.claude-sonnet-4-6',
      'global.anthropic.claude-sonnet-4-5',
      'us.anthropic.claude-sonnet-4-5',
    ]);
    // After us. preference: still 2 matches (us. 4-6 and us. 4-5). Reject.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('model_not_in_registry');
  });

  it('rejects when short form has no substring match in any full id', () => {
    const result = validateCallerModel(SHORT_FORM, ['gpt-oss:20b', 'gemini-2.5-flash']);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('model_not_in_registry');
  });

  it('non-Anthropic models pass through (no canonicalization in upstream openagentic for these)', () => {
    // Vertex/Ollama don't get canonicalized — they're already short. Validation
    // is plain string-equals.
    const result = validateCallerModel('gemini-2.5-flash', ['gemini-2.5-flash', FULL_BEDROCK]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.model).toBe('gemini-2.5-flash');
  });
});
