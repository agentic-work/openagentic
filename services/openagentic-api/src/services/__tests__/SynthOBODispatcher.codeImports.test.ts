/**
 * #780 / Q1-blocker-11 follow-up (Q1-blocker-12, 2026-05-13) — rip the
 * narrative-intent regex guard from SynthOBODispatcher. The model can
 * dodge intent-regex by saying "across clouds" or "compute on data". The
 * CODE itself is ground truth — if the model writes `import boto3`, the
 * runtime WILL try to call AWS. We gate on that structural signal.
 *
 * This pins the new contract:
 *   - code imports boto3 / azure.* / google.cloud / etc.
 *     + capabilities missing matching cloud → REFUSE
 *   - code has no cloud SDK imports + ANY intent text → ALLOW (the dispatcher
 *     can't predict fabrication that happens in model prose AFTER synth
 *     returns; that's a different layer's problem)
 *
 * Live evidence from Q1-redrive-post-phase-A-d21bc8d9:
 *   model intent "Calculate MoM cost changes across clouds" + capabilities:[]
 *   slipped past CLOUD_INTENT_PATTERNS (no per-provider word match) → ran
 *   placeholder code → model fabricated $518/$83/$74 Bedrock figures in
 *   prose. New guard targets boto3 / azure.* / google.cloud imports
 *   specifically — if model wants to call cloud SDKs, it must declare.
 */
import { describe, it, expect, vi } from 'vitest';
import { executeSynthOBO } from '../SynthOBODispatcher.js';

const SILENT_LOGGER = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeStubBroker() {
  return {
    brokerFor: vi.fn().mockResolvedValue({
      aws: {
        AWS_ACCESS_KEY_ID: 'AKIA-x',
        AWS_SECRET_ACCESS_KEY: 'sec',
        AWS_SESSION_TOKEN: 'tok',
        AWS_DEFAULT_REGION: 'us-east-1',
      },
    }),
  };
}

function makeStubClient() {
  return {
    execute: vi.fn().mockResolvedValue({
      success: true,
      stdout: 'ok',
      stderr: '',
      result: null,
      executionTimeMs: 5,
    }),
  };
}

describe('SynthOBODispatcher — Q1-blocker-12 code-import guard (no narrative regex)', () => {
  it('refuses when code does `import boto3` and capabilities omits aws', async () => {
    const broker = makeStubBroker();
    const client = makeStubClient();
    const result = await executeSynthOBO(
      { userId: 'u1', userJwt: 'eyJ-test', logger: SILENT_LOGGER },
      {
        code: 'import boto3\nce = boto3.client("ce")\nprint(ce.get_cost_and_usage())',
        intent: 'data analysis',
        capabilities: [],
      },
      { broker, client },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/aws/i);
    expect(client.execute).not.toHaveBeenCalled();
  });

  it('refuses when code does `from azure.identity import ...` and capabilities omits azure', async () => {
    const broker = makeStubBroker();
    const client = makeStubClient();
    const result = await executeSynthOBO(
      { userId: 'u1', userJwt: 'eyJ-test', logger: SILENT_LOGGER },
      {
        code: 'from azure.identity import DefaultAzureCredential\nfrom azure.mgmt.consumption import ConsumptionManagementClient',
        intent: 'compute',
        capabilities: ['http', 'json'],
      },
      { broker, client },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/azure/i);
    expect(client.execute).not.toHaveBeenCalled();
  });

  it('refuses when code does `from google.cloud import ...` and capabilities omits gcp', async () => {
    const broker = makeStubBroker();
    const client = makeStubClient();
    const result = await executeSynthOBO(
      { userId: 'u1', userJwt: 'eyJ-test', logger: SILENT_LOGGER },
      {
        code: 'from google.cloud import billing\nclient = billing.CloudBillingClient()',
        intent: 'analyse',
        capabilities: [],
      },
      { broker, client },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/gcp/i);
    expect(client.execute).not.toHaveBeenCalled();
  });

  it('allows generic "across clouds" intent when code has zero cloud SDK imports (Q1-blocker-12 fix)', async () => {
    // The Q1-redrive evasion: model used the phrase "across clouds" generically
    // and the old intent-regex didn't fire. With the new code-import guard,
    // pure-compute code is fine — the dispatcher can't predict prose-layer
    // fabrication and shouldn't block legitimate compute.
    const broker = makeStubBroker();
    const client = makeStubClient();
    const result = await executeSynthOBO(
      { userId: 'u1', userJwt: 'eyJ-test', logger: SILENT_LOGGER },
      {
        code: 'data = {"aws": 100, "azure": 200, "gcp": 50}\nprint(sum(data.values()))',
        intent: 'Calculate MoM cost changes across clouds',
        capabilities: [],
      },
      { broker, client },
    );
    expect(result.ok).toBe(true);
    expect(client.execute).toHaveBeenCalled();
  });

  it('allows pure compute code with no cloud SDK imports + empty caps', async () => {
    const broker = makeStubBroker();
    const client = makeStubClient();
    const result = await executeSynthOBO(
      { userId: 'u1', userJwt: 'eyJ-test', logger: SILENT_LOGGER },
      {
        code: 'import json\nimport datetime\nprint(json.dumps({"now": datetime.datetime.now().isoformat()}))',
        intent: 'compute current timestamp',
        capabilities: [],
      },
      { broker, client },
    );
    expect(result.ok).toBe(true);
    expect(client.execute).toHaveBeenCalled();
  });

  it('refuses when code imports boto3 even when intent is generic / non-cloud', async () => {
    // Structural check: code WILL hit AWS regardless of narrative intent
    const broker = makeStubBroker();
    const client = makeStubClient();
    const result = await executeSynthOBO(
      { userId: 'u1', userJwt: 'eyJ-test', logger: SILENT_LOGGER },
      {
        code: 'import boto3\nbedrock = boto3.client("bedrock")',
        intent: 'just running some code',
        capabilities: [],
      },
      { broker, client },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/aws/i);
    expect(client.execute).not.toHaveBeenCalled();
  });

  it('allows when code imports boto3 AND capabilities includes aws', async () => {
    const broker = makeStubBroker();
    const client = makeStubClient();
    const result = await executeSynthOBO(
      { userId: 'u1', userJwt: 'eyJ-test', logger: SILENT_LOGGER },
      {
        code: 'import boto3\nce = boto3.client("ce")',
        intent: 'AWS cost query',
        capabilities: ['aws'],
      },
      { broker, client },
    );
    expect(result.ok).toBe(true);
    expect(broker.brokerFor).toHaveBeenCalledWith('eyJ-test', ['aws']);
    expect(client.execute).toHaveBeenCalled();
  });
});
