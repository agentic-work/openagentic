#!/usr/bin/env node
/**
 * Router Tuning Harness — runs 100+ prompts through the live
 * /api/admin/router-tuning/simulate endpoint and asserts each one routes
 * to the expected family/tier. Reports mismatches so we can iterate on
 * tuning weights + MCR values until the algo behaves correctly across
 * the full spectrum.
 *
 * Usage:
 *   ts-node services/openagentic-api/scripts/router-tuning-harness.ts \
 *     --base https://chat-dev.openagentic.io \
 *     --cookie "$(cat /tmp/chatdev-cookie.txt)"
 *
 * The cookie must be a valid admin session cookie. Run the smoke test
 * with Playwright first to capture it, or copy from a logged-in browser.
 */

interface Case {
  id: string;
  prompt: string;
  tier: 'easy' | 'medium' | 'hard';
  // Expected — at least ONE of these must match
  expectFamily?: string[]; // e.g. ['gpt-oss', 'haiku']
  expectTier?: Array<'low' | 'mid' | 'high' | 'frontier'>;
  expectNotFamily?: string[]; // e.g. ['claude'] for easy prompts — shouldn't pick Sonnet
  expectResolvedBy?: string[]; // e.g. ['chat_pool_floor']
  // For scoring-tie prevention
  expectWinnerLeadsBy?: number; // min score diff from #2
  note?: string;
}

const CASES: Case[] = [
  // ==================================================================
  // EASY — pure chat, no tools, short response. Should route to cheap
  // local high-FCA chat model (gpt-oss, haiku, flash). NEVER to Sonnet/
  // Opus frontier models.
  // ==================================================================
  { id: 'easy-1', tier: 'easy', prompt: 'what is 2+2?', expectNotFamily: ['claude'] },
  { id: 'easy-2', tier: 'easy', prompt: 'what is 7 times 8?', expectNotFamily: ['claude'] },
  { id: 'easy-3', tier: 'easy', prompt: 'write me a haiku about the sea', expectNotFamily: ['claude'] },
  { id: 'easy-4', tier: 'easy', prompt: 'why is the sky blue?', expectNotFamily: ['claude'] },
  { id: 'easy-5', tier: 'easy', prompt: 'hello, how are you?', expectNotFamily: ['claude'] },
  { id: 'easy-6', tier: 'easy', prompt: "what's the capital of France?", expectNotFamily: ['claude'] },
  { id: 'easy-7', tier: 'easy', prompt: 'define photosynthesis', expectNotFamily: ['claude'] },
  { id: 'easy-8', tier: 'easy', prompt: 'tell me a joke', expectNotFamily: ['claude'] },
  { id: 'easy-9', tier: 'easy', prompt: 'what day of the week is it today?', expectNotFamily: ['claude'] },
  { id: 'easy-10', tier: 'easy', prompt: 'spell banana', expectNotFamily: ['claude'] },
  { id: 'easy-11', tier: 'easy', prompt: 'convert 50 fahrenheit to celsius', expectNotFamily: ['claude'] },
  { id: 'easy-12', tier: 'easy', prompt: 'give me a short greeting in french', expectNotFamily: ['claude'] },
  { id: 'easy-13', tier: 'easy', prompt: 'what is the meaning of life?', expectNotFamily: ['claude'] },
  { id: 'easy-14', tier: 'easy', prompt: 'are cats better than dogs?', expectNotFamily: ['claude'] },
  { id: 'easy-15', tier: 'easy', prompt: 'summarize this thread so far', expectNotFamily: ['claude'] },
  { id: 'easy-16', tier: 'easy', prompt: 'how many stars in the milky way?', expectNotFamily: ['claude'] },
  { id: 'easy-17', tier: 'easy', prompt: 'name three primary colors', expectNotFamily: ['claude'] },
  { id: 'easy-18', tier: 'easy', prompt: 'what does API stand for?', expectNotFamily: ['claude'] },
  { id: 'easy-19', tier: 'easy', prompt: 'write a two-sentence bio', expectNotFamily: ['claude'] },
  { id: 'easy-20', tier: 'easy', prompt: 'good morning', expectNotFamily: ['claude'] },
  { id: 'easy-21', tier: 'easy', prompt: 'translate "thank you" to spanish', expectNotFamily: ['claude'] },
  { id: 'easy-22', tier: 'easy', prompt: 'how old is the pyramid of giza?', expectNotFamily: ['claude'] },
  { id: 'easy-23', tier: 'easy', prompt: 'list 3 popular JS frameworks', expectNotFamily: ['claude'] },
  { id: 'easy-24', tier: 'easy', prompt: 'what is REST?', expectNotFamily: ['claude'] },
  { id: 'easy-25', tier: 'easy', prompt: "what's a kubernetes pod?", expectNotFamily: ['claude'] },

  // ==================================================================
  // MEDIUM — single-domain tools, list/describe operations, short
  // research. Should route to high-FCA tool caller (haiku/sonnet).
  // ==================================================================
  { id: 'med-1', tier: 'medium', prompt: 'list my azure subscriptions', expectTier: ['high', 'frontier'] },
  { id: 'med-2', tier: 'medium', prompt: 'show me my S3 buckets in us-east-1', expectTier: ['high', 'frontier'] },
  { id: 'med-3', tier: 'medium', prompt: 'describe the resource group rg-prod-01', expectTier: ['high', 'frontier'] },
  { id: 'med-4', tier: 'medium', prompt: 'get me the list of azure aks clusters in my tenant', expectTier: ['high', 'frontier'] },
  { id: 'med-5', tier: 'medium', prompt: 'inventory all my VMs in eastus2', expectTier: ['high', 'frontier'] },
  { id: 'med-6', tier: 'medium', prompt: 'count how many pods are running in my AKS cluster', expectTier: ['high', 'frontier'] },
  { id: 'med-7', tier: 'medium', prompt: 'show activity logs for my subscription for the last 24 hours', expectTier: ['high', 'frontier'] },
  { id: 'med-8', tier: 'medium', prompt: 'find all storage accounts that are public', expectTier: ['high', 'frontier'] },
  { id: 'med-9', tier: 'medium', prompt: 'audit my IAM roles and list any with admin permissions', expectTier: ['high', 'frontier'] },
  { id: 'med-10', tier: 'medium', prompt: 'query my key vaults for certificates expiring in the next 30 days', expectTier: ['high', 'frontier'] },
  { id: 'med-11', tier: 'medium', prompt: 'get the cost breakdown for my azure subscription last month', expectTier: ['high', 'frontier'] },
  { id: 'med-12', tier: 'medium', prompt: 'list all my lambda functions in aws', expectTier: ['high', 'frontier'] },
  { id: 'med-13', tier: 'medium', prompt: 'describe my rds instance mydb-prod', expectTier: ['high', 'frontier'] },
  { id: 'med-14', tier: 'medium', prompt: 'show me the network security group rules for my vnet', expectTier: ['high', 'frontier'] },
  { id: 'med-15', tier: 'medium', prompt: 'find all snapshots older than 30 days', expectTier: ['high', 'frontier'] },
  { id: 'med-16', tier: 'medium', prompt: 'list all my gcp projects and their billing accounts', expectTier: ['high', 'frontier'] },
  { id: 'med-17', tier: 'medium', prompt: 'describe the deployment openagentic-api in agentic-dev namespace', expectTier: ['high', 'frontier'] },
  { id: 'med-18', tier: 'medium', prompt: 'show me the last 10 failed pipeline runs', expectTier: ['high', 'frontier'] },
  { id: 'med-19', tier: 'medium', prompt: 'inventory my container registries', expectTier: ['high', 'frontier'] },
  { id: 'med-20', tier: 'medium', prompt: 'list secrets in my key vault', expectTier: ['high', 'frontier'] },
  { id: 'med-21', tier: 'medium', prompt: 'query my log analytics workspace for recent errors', expectTier: ['high', 'frontier'] },
  { id: 'med-22', tier: 'medium', prompt: 'get me the current cost of my production environment', expectTier: ['high', 'frontier'] },
  { id: 'med-23', tier: 'medium', prompt: 'audit my RBAC assignments', expectTier: ['high', 'frontier'] },

  // ==================================================================
  // HARD — multi-step reasoning, multi-cloud, complex planning.
  // Should route to frontier tier (claude sonnet, opus, gpt-5).
  // ==================================================================
  { id: 'hard-1', tier: 'hard', prompt: 'design a multi-region active-active architecture on AWS with automated failover and explain the tradeoffs', expectTier: ['frontier'] },
  { id: 'hard-2', tier: 'hard', prompt: 'compare our azure vs aws spend over the last 90 days and explain the main drivers of cost', expectTier: ['frontier'] },
  { id: 'hard-3', tier: 'hard', prompt: 'propose a 4-phase migration from on-prem postgres to cloud SQL with rollback plan', expectTier: ['frontier'] },
  { id: 'hard-4', tier: 'hard', prompt: 'analyze our multi-cloud topology then generate an interactive architecture diagram comparing current vs proposed consolidated state', expectTier: ['frontier'] },
  { id: 'hard-5', tier: 'hard', prompt: 'first inventory all my azure resources then generate a cost optimization report with specific recommendations', expectTier: ['frontier'] },
  { id: 'hard-6', tier: 'hard', prompt: 'explain step by step how to design a fault-tolerant microservices architecture with circuit breakers and service mesh', expectTier: ['frontier'] },
  { id: 'hard-7', tier: 'hard', prompt: 'write a detailed analysis of the tradeoffs between kubernetes and serverless for our ML training workloads', expectTier: ['frontier'] },
  { id: 'hard-8', tier: 'hard', prompt: 'spawn subagents to draft migration runbooks for each workload, then benchmark equivalent workloads on azure vs aws vs gcp', expectTier: ['frontier'] },
  { id: 'hard-9', tier: 'hard', prompt: 'analyze my current security posture across azure and aws, identify gaps against the CIS benchmarks, then generate a remediation plan', expectTier: ['frontier'] },
  { id: 'hard-10', tier: 'hard', prompt: 'design an incident response runbook for a cross-cloud data breach scenario involving azure active directory and aws iam', expectTier: ['frontier'] },
  { id: 'hard-11', tier: 'hard', prompt: 'architect a data lakehouse that ingests from azure data factory, aws kinesis, and gcp pubsub in parallel', expectTier: ['frontier'] },
  { id: 'hard-12', tier: 'hard', prompt: 'compare the reliability, cost, and latency of deploying our API on azure app service vs aws lambda vs gcp cloud run', expectTier: ['frontier'] },

  // ==================================================================
  // DESTRUCTIVE — must escalate to frontier regardless of slider.
  // ==================================================================
  { id: 'destr-1', tier: 'hard', prompt: 'delete resource group rg-prod-01 and everything inside', expectTier: ['frontier'], expectResolvedBy: ['destructive_escalation'] },
  { id: 'destr-2', tier: 'hard', prompt: 'terminate all my ec2 instances in us-east-1', expectTier: ['frontier'], expectResolvedBy: ['destructive_escalation'] },
  { id: 'destr-3', tier: 'hard', prompt: 'drop the database users in my postgres cluster', expectTier: ['frontier'], expectResolvedBy: ['destructive_escalation'] },
  { id: 'destr-4', tier: 'hard', prompt: 'purge all snapshots older than 90 days', expectTier: ['frontier'], expectResolvedBy: ['destructive_escalation'] },

  // ==================================================================
  // EDGE — ambiguous/tricky prompts to probe heuristics.
  // ==================================================================
  { id: 'edge-1', tier: 'easy', prompt: 'make me a function to calculate fibonacci', expectNotFamily: ['claude'], note: 'code generation — simple, should NOT escalate to claude despite "function" keyword' },
  { id: 'edge-2', tier: 'easy', prompt: 'explain what recursion is in one paragraph', expectNotFamily: ['claude'], note: 'definition, not analysis' },
  { id: 'edge-3', tier: 'medium', prompt: 'show me my azure vms with more than 16gb ram', expectTier: ['high', 'frontier'] },
  { id: 'edge-4', tier: 'medium', prompt: 'give me a report on all azure subscriptions I have access to', expectTier: ['high', 'frontier'] },
  { id: 'edge-5', tier: 'hard', prompt: 'analyze and compare then explain why our production latency has increased over the last quarter', expectTier: ['frontier'] },
];

async function runCase(base: string, cookie: string, c: Case): Promise<{
  id: string;
  prompt: string;
  tier: string;
  winner: string;
  winnerFamily: string;
  winnerTier: string;
  resolvedBy: string;
  pass: boolean;
  reasons: string[];
  scoreLead: number;
}> {
  const reasons: string[] = [];
  const res = await fetch(`${base}/api/admin/router-tuning/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ prompt: c.prompt }),
  });
  const data = await res.json() as any;
  if (!data?.success) {
    return {
      id: c.id,
      prompt: c.prompt,
      tier: c.tier,
      winner: '(none)',
      winnerFamily: '(none)',
      winnerTier: '(none)',
      resolvedBy: '(none)',
      pass: false,
      reasons: [`simulate failed: ${data?.message || 'unknown'}`],
      scoreLead: 0,
    };
  }

  const winner: string = data.decision.selectedModelId;
  const winnerTier: string = data.decision.tier;
  const resolvedBy: string = data.decision.resolvedBy;
  const top = data.ranked?.[0];
  const second = data.ranked?.[1];
  const scoreLead = top && second ? top.score - second.score : 0;

  // Infer family from winner id (cheap string match)
  const lid = winner.toLowerCase();
  const winnerFamily = lid.includes('claude') ? 'claude'
    : lid.includes('gpt-oss') ? 'gpt-oss'
    : lid.includes('gpt') ? 'gpt'
    : lid.includes('gemini') ? 'gemini'
    : lid.includes('haiku') ? 'haiku'
    : lid.includes('llama') ? 'llama'
    : lid.includes('qwen') ? 'qwen'
    : 'unknown';

  if (c.expectFamily && !c.expectFamily.some(f => winnerFamily.includes(f))) {
    reasons.push(`winner family "${winnerFamily}" not in expected [${c.expectFamily.join(',')}]`);
  }
  if (c.expectNotFamily && c.expectNotFamily.some(f => winnerFamily.includes(f))) {
    reasons.push(`winner family "${winnerFamily}" should NOT be ${c.expectNotFamily.join('|')}`);
  }
  if (c.expectTier && !c.expectTier.includes(winnerTier as any)) {
    reasons.push(`winner tier "${winnerTier}" not in expected [${c.expectTier.join(',')}]`);
  }
  if (c.expectResolvedBy && !c.expectResolvedBy.includes(resolvedBy)) {
    reasons.push(`resolvedBy "${resolvedBy}" not in expected [${c.expectResolvedBy.join(',')}]`);
  }
  if (c.expectWinnerLeadsBy && scoreLead < c.expectWinnerLeadsBy) {
    reasons.push(`score lead ${scoreLead.toFixed(1)} < expected ${c.expectWinnerLeadsBy}`);
  }

  return {
    id: c.id,
    prompt: c.prompt,
    tier: c.tier,
    winner,
    winnerFamily,
    winnerTier,
    resolvedBy,
    pass: reasons.length === 0,
    reasons,
    scoreLead,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const baseIdx = args.indexOf('--base');
  const cookieIdx = args.indexOf('--cookie');
  const base = baseIdx >= 0 ? args[baseIdx + 1] : 'https://chat-dev.openagentic.io';
  const cookie = cookieIdx >= 0 ? args[cookieIdx + 1] : '';
  const filter = (() => {
    const i = args.indexOf('--filter');
    return i >= 0 ? args[i + 1] : null;
  })();
  if (!cookie) {
    console.error('Need --cookie "<auth cookie>"');
    process.exit(1);
  }

  const cases = filter ? CASES.filter(c => c.id.includes(filter) || c.tier === filter) : CASES;

  console.log(`\n🧪 Router Tuning Harness — ${cases.length} cases against ${base}\n`);

  const results: Awaited<ReturnType<typeof runCase>>[] = [];
  for (const c of cases) {
    const r = await runCase(base, cookie, c);
    results.push(r);
    const marker = r.pass ? '✅' : '❌';
    const shortPrompt = c.prompt.length > 70 ? c.prompt.slice(0, 67) + '…' : c.prompt;
    console.log(`${marker} ${c.id.padEnd(10)} [${c.tier.padEnd(6)}] → ${r.winner.padEnd(44)} (${r.winnerTier}, by ${r.resolvedBy}, +${r.scoreLead.toFixed(1)}) — "${shortPrompt}"`);
    if (!r.pass) {
      for (const reason of r.reasons) {
        console.log(`    └─ ${reason}`);
      }
    }
  }

  const pass = results.filter(r => r.pass).length;
  const fail = results.filter(r => !r.pass).length;
  console.log(`\n── Summary ────────────────────────────────────────────`);
  console.log(`Pass: ${pass}/${results.length} (${(pass / results.length * 100).toFixed(1)}%)`);
  console.log(`Fail: ${fail}/${results.length}`);
  if (fail > 0) {
    console.log(`\nBy tier:`);
    for (const tier of ['easy', 'medium', 'hard']) {
      const tierResults = results.filter(r => r.tier === tier);
      const tierPass = tierResults.filter(r => r.pass).length;
      console.log(`  ${tier.padEnd(7)} ${tierPass}/${tierResults.length} pass`);
    }
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Harness crashed:', err);
  process.exit(1);
});
