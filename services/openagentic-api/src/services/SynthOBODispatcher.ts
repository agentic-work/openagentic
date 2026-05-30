/**
 * SynthOBODispatcher — OBO-aware wrapper around executeSynthExecute
 * (chatmode-rip Phase C.5 dispatcher refactor).
 *
 * Plan: docs/superpowers/plans/2026-05-10-chatmode-rip-implementation.md
 * §Phase C task C.5. Wraps the existing executeSynthExecute with the
 * On-Behalf-Of credential brokering pipeline:
 *
 *   ctx.userJwt
 *      ↓ (require non-empty; refuse otherwise — no service-account fallback)
 *   filter input.capabilities[] → cloud targets (aws/azure/gcp)
 *      ↓ (skip broker entirely when no cloud capabilities)
 *   CredentialBroker.brokerFor(userJwt, [cloud targets])
 *      ↓
 *   flatten BrokeredCredentials → Record<string,string> env-var bundle
 *      ↓
 *   executeSynthExecute({ ...input, credentials: flattened })
 *
 * Keeps the existing executeSynthExecute untouched so test paths and
 * the legacy synth_execute call site can keep using the simpler entry.
 *
 * Security contract (all tested):
 *   - Refuses if userJwt missing → returns clear ok:false error,
 *     never reaches the broker (prevents service-account drift)
 *   - Filters non-cloud capability strings (http/json/datetime/github
 *     /slack/etc.) — only AWS/Azure/GCP go to brokerFor
 *   - Broker errors surface as ok:false with the broker's message;
 *     client.execute is NEVER called when broker throws (no leaked
 *     creds, no executor invocation on bad auth)
 *   - Brokered creds are forwarded only via input.credentials — never
 *     logged in plaintext. Logger.warn / .info take the {capabilities,
 *     userId} keys but never the cred bundle itself.
 */

import type { CloudTarget, BrokeredCredentials } from './CredentialBroker.js';
import {
  executeSynthExecute,
  type SynthExecuteInput,
  type SynthExecuteOutput,
  type SynthExecuteDeps,
} from './SynthExecuteTool.js';

const CLOUD_TARGETS: ReadonlySet<string> = new Set<CloudTarget>(['aws', 'azure', 'gcp']);

/**
 * #780 / Q1-blocker-12 (2026-05-13) — no-confab guard pivoted from
 * narrative-intent regex to code-import scan.
 *
 * Pre-Q1-blocker-12 history: a regex over the model's `intent` field
 * matched per-provider words ("AWS", "Azure", "GCP"). The model could
 * dodge it by rephrasing as "compute cost across clouds" — generic
 * narrative, no per-provider word, regex didn't fire, model fabricated
 * provider data from a no-credentials sandbox. See
 * `reports/verify-cadence/Q1-redrive-post-phase-A-d21bc8d9/` for the
 * smoking-gun: intent="Calculate MoM cost changes ... across clouds"
 * + capabilities:[] → fabricated $518 / $83 / $74 Bedrock service rows.
 *
 * New contract: gate on what the CODE will actually do (Python imports
 * = structural behavior prediction), not on what the model SAYS it's
 * doing (narrative). If `input.code` imports a cloud SDK and the call
 * doesn't declare matching cloud capability, refuse. Generic narrative
 * with no cloud imports is allowed — pure compute on inline data is a
 * legitimate use of synth.
 *
 * Per-cloud SDK signatures (substring match — simple structural check,
 * NOT regex-over-narrative):
 *   aws   → import boto3 / from boto3 / import botocore / from botocore
 *           import aiobotocore / from aiobotocore
 *   azure → import azure. / from azure. (identity, mgmt.*, storage,
 *           core, cosmos, keyvault, servicebus, eventhub, …)
 *   gcp   → from google.cloud / import google.cloud / from
 *           googleapiclient / from google.auth
 *
 * Extending: add new substrings to the relevant array. Each entry is a
 * concrete Python syntactic pattern (an `import` / `from … import`
 * statement form). Substring `.includes()` is the matcher — no regex.
 */
const CLOUD_SDK_IMPORT_SIGNATURES: ReadonlyMap<CloudTarget, ReadonlyArray<string>> =
  new Map([
    [
      'aws',
      [
        'import boto3',
        'from boto3',
        'import botocore',
        'from botocore',
        'import aiobotocore',
        'from aiobotocore',
      ],
    ],
    [
      'azure',
      [
        'import azure.',
        'from azure.',
      ],
    ],
    [
      'gcp',
      [
        'from google.cloud',
        'import google.cloud',
        'from googleapiclient',
        'import googleapiclient',
        'from google.auth',
        'import google.auth',
      ],
    ],
  ]);

/**
 * Return the set of cloud targets whose SDK is imported in `code` but
 * NOT declared in `requestedClouds`. Empty result = no mismatch (caller
 * proceeds). The check is a plain substring scan against each cloud's
 * concrete import-statement signatures — structural Python syntax, not
 * narrative pattern-matching.
 */
function findCodeCloudImportMismatches(
  code: string,
  requestedClouds: ReadonlyArray<CloudTarget>,
): CloudTarget[] {
  if (!code) return [];
  const declared = new Set(requestedClouds);
  const missing: CloudTarget[] = [];
  for (const [cloud, signatures] of CLOUD_SDK_IMPORT_SIGNATURES) {
    if (signatures.some((sig) => code.includes(sig)) && !declared.has(cloud)) {
      missing.push(cloud);
    }
  }
  return missing;
}

export interface SynthOBOCtx {
  userId?: string;
  sessionId?: string;
  userEmail?: string;
  /**
   * User's Azure AD ACCESS token. Set by `runChat.ts` via `extractUserJwt`
   * (Phase C.6). When undefined / empty, the dispatcher refuses without
   * calling the broker — no service-account fallback by design.
   */
  userJwt?: string;
  logger?: {
    info: (...a: unknown[]) => void;
    warn: (...a: unknown[]) => void;
    error: (...a: unknown[]) => void;
    debug: (...a: unknown[]) => void;
  };
}

export interface SynthOBOBrokerLike {
  brokerFor: (userJwt: string, clouds: CloudTarget[]) => Promise<BrokeredCredentials>;
}

export interface SynthOBODeps extends SynthExecuteDeps {
  /** CredentialBroker (or test stub matching the brokerFor signature). */
  broker: SynthOBOBrokerLike;
}

/**
 * Flatten BrokeredCredentials → flat Record<string,string> the synth
 * executor consumes via input.credentials. Layout:
 *   aws   → AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_SESSION_TOKEN + AWS_DEFAULT_REGION
 *   azure → AZURE_ACCESS_TOKEN
 *   gcp   → GOOGLE_SA_JSON
 */
function flattenBrokeredCreds(creds: BrokeredCredentials): Record<string, string> {
  const out: Record<string, string> = {};
  if (creds.aws) {
    Object.assign(out, creds.aws);
  }
  if (creds.azure) {
    Object.assign(out, creds.azure);
  }
  if (creds.gcp) {
    Object.assign(out, creds.gcp);
  }
  return out;
}

export async function executeSynthOBO(
  ctx: SynthOBOCtx,
  input: SynthExecuteInput,
  deps: SynthOBODeps,
): Promise<SynthExecuteOutput> {
  if (typeof ctx.userJwt !== 'string' || ctx.userJwt.length === 0) {
    return {
      ok: false,
      error:
        'synth requires the user to be signed in (userJwt missing). ' +
        'On-Behalf-Of credential brokering only runs for authenticated users.',
    };
  }

  const requestedClouds: CloudTarget[] = (input.capabilities ?? [])
    .filter((c): c is CloudTarget => typeof c === 'string' && CLOUD_TARGETS.has(c));

  // #780 / Q1-blocker-12 (2026-05-13) — code-import-vs-capabilities gate.
  // If `input.code` imports a cloud SDK (boto3 / azure.* / google.cloud /
  // googleapiclient / google.auth) without the matching cloud capability,
  // refuse: the runtime WILL attempt a no-credentials cloud API call and
  // either fail unhelpfully or return placeholder output the model then
  // fabricates from. Gate on code structure, not on narrative intent.
  const missingClouds = findCodeCloudImportMismatches(input.code ?? '', requestedClouds);
  if (missingClouds.length > 0) {
    ctx.logger?.warn?.(
      { userId: ctx.userId, missingClouds, requestedClouds },
      '[synth-obo] code-imports-vs-capabilities mismatch — refusing to run without cloud scope',
    );
    return {
      ok: false,
      error:
        `synth refused: code imports ${missingClouds.join(' / ')} SDK but the call ` +
        `omits matching capabilit${missingClouds.length === 1 ? 'y' : 'ies'} ` +
        `[${missingClouds.join(', ')}]. ` +
        `Either (a) re-call synth with capabilities including ${missingClouds.join(' / ')}, ` +
        `or (b) use the appropriate MCP tool (aws_cost_query / azure_cost_query / ` +
        `gcp_billing_query / etc.) — discoverable via tool_search.`,
    };
  }

  let credentials: Record<string, string> | undefined;
  if (requestedClouds.length > 0) {
    try {
      const brokered = await deps.broker.brokerFor(ctx.userJwt, requestedClouds);
      const flat = flattenBrokeredCreds(brokered);
      credentials = Object.keys(flat).length > 0 ? flat : undefined;
    } catch (err) {
      ctx.logger?.warn?.(
        { err: (err as Error)?.message ?? String(err), userId: ctx.userId, clouds: requestedClouds },
        '[synth-obo] credential broker failed',
      );
      return {
        ok: false,
        error: `credential broker failed: ${(err as Error)?.message ?? String(err)}`,
      };
    }
  }

  return executeSynthExecute(ctx, { ...input, credentials }, { client: deps.client });
}
