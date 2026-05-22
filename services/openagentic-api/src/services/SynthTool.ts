/**
 * SynthTool — chatmode-rip 10-primitive T1 definition (Phase C.5).
 *
 * Renames the T1 surface from `synth_execute` to `synth`. The legacy
 * SynthExecuteTool.ts remains in place during the C.1 catalog cutover so
 * mid-flight chats don't get a name flip mid-turn; once C.1 lands, the
 * legacy file is deletable and the dispatcher routes only `synth`.
 *
 * Description vs the legacy:
 *   - Highlights On-Behalf-Of credential brokering: synth runs as the
 *     CALLING USER for cloud capabilities. The dispatcher (follow-up
 *     commit) refuses if userJwt missing — never falls back to a service
 *     account.
 *   - Surfaces the capability declaration discipline: list every cloud /
 *     SaaS capability the code touches; admins can pre-approve outside
 *     the default set.
 *   - Removes redundant timeout knobs (operator policy at the executor).
 */

import type { SynthExecuteInput, SynthExecuteOutput } from './SynthExecuteTool.js';

const DESCRIPTION = [
  'Run a one-shot Python script in the platform sandbox to TRANSFORM,',
  'AGGREGATE, or COMPUTE values from data ALREADY in the conversation.',
  '',
  'DO NOT call synth to retrieve cloud, platform, or SaaS data — there',
  'are dedicated typed tools for that (openagentic_aws.*, openagentic_azure.*, openagentic_gcp.*,',
  'openagentic_k8s.*, aws_*, azure_*, gcp_*, k8s_*, kubectl_*, github_*, slack_*).',
  'Always prefer the typed tool over synth when both could answer the',
  'question. Calling synth BEFORE you have real data on hand leads to',
  'fabricated / hallucinated results — synth has no built-in knowledge',
  'of the user\'s cloud spend, resources, or accounts.',
  '',
  'WHEN TO USE synth: stitching outputs of prior tool calls together,',
  'one-off math / unit conversion, parsing or reshaping a structured',
  'blob already returned by another tool, ad-hoc HTTP against a niche',
  'public API the platform does not ship a tool for.',
  '',
  'On-Behalf-Of (OBO): synth runs AS THE CALLING USER. Cloud / SaaS',
  'capabilities are brokered against the user\'s identity — never a',
  'shared service account.',
  '',
  'Capability declaration: list every external capability the code uses',
  'in the `capabilities` array. The platform brokers credentials per',
  'capability and gates capabilities outside the default set on admin',
  'pre-approval.',
  '',
  'NOT for shell commands. Python only. Returns stdout / stderr / result.',
].join('\n');

export const SYNTH_TOOL = {
  type: 'function' as const,
  function: {
    name: 'synth',
    description: DESCRIPTION,
    parameters: {
      type: 'object' as const,
      properties: {
        code: {
          type: 'string' as const,
          description:
            'Python source code to execute. Must be self-contained — no implicit imports beyond Python stdlib + declared capabilities.',
        },
        intent: {
          type: 'string' as const,
          description:
            'Short human-readable summary of what this code does. Surfaces in the audit log and the synth tool-card.',
        },
        capabilities: {
          type: 'array' as const,
          items: { type: 'string' as const },
          description:
            'Capability names this code uses. Examples: "http", "json", "datetime", "aws", "azure", "github". Cloud capabilities trigger user-OBO credential brokering; capabilities beyond the default set require admin pre-approval.',
        },
      },
      required: ['code', 'intent'] as string[],
      additionalProperties: false as const,
    },
  },
};

export function isSynthTool(name: string): boolean {
  return name === 'synth';
}

/**
 * Re-export the legacy IO types so callers porting from synth_execute to
 * synth don't need to re-import. Shapes are intentionally identical so
 * the dispatcher can be ported one call site at a time.
 */
export type SynthInput = SynthExecuteInput;
export type SynthOutput = SynthExecuteOutput;
