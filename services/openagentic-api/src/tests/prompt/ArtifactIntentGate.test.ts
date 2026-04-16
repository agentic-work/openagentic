import { describe, expect, it } from 'vitest';
import { evaluateUserIntent } from '../../services/prompt/ArtifactIntentGate.js';

/**
 * ArtifactIntentGate test surface.
 *
 * The cases below codify the asymmetric cost we want from the gate (see
 * openagentic-omhs#327): false negatives are cheap (user can ask for a
 * chart explicitly), false positives are expensive (response gets a
 * thousand-token artifact injection nobody wanted).
 *
 * Every "should NOT trigger" assertion is a regression test against a
 * specific bad heuristic that lived in the old `isDiagramRequest`.
 */
describe('ArtifactIntentGate.evaluateUserIntent', () => {
  describe('positive intent (visualization wanted)', () => {
    it.each([
      'create a sankey diagram of my Azure costs',
      'make a chart showing tenant spend by service',
      'build a dashboard for our K8s cluster',
      'render an artifact summarising this',
      'show me my costs as a chart',
      'visualize this for me',
      'plot the latency over time',
      'graph this dataset',
      'I need a flowchart of the request path',
      'draw a diagram of the network topology',
      'in chart form please',
      'as a sankey, please',
    ])('triggers on: %s', (msg) => {
      const decision = evaluateUserIntent(msg);
      expect(decision.intent).toBe('visualization');
      expect(decision.reason).not.toBe('no-visual-signal');
    });
  });

  describe('negative intent (no visualization wanted) — #327 regressions', () => {
    it.each([
      // The exact failure mode from #327: any cloud + cost mention used to
      // trigger a Sankey directive. It must not now.
      'what are my Azure costs this month',
      'how much did we spend on AWS last quarter',
      'list my GCP services',
      'why is my Azure bill so high',
      // Old heuristic: `'breakdown'` was a visualization keyword. It isn't.
      'give me a breakdown of last week incidents',
      // Old heuristic: `'show me'` always triggered. It mustn't on its own.
      'show me the last 10 errors',
      'show me which services are unhealthy',
      // Old heuristic: 2 cloud-related keywords triggered. Lots of normal
      // questions hit that bar.
      'list the resources in my Azure subscription',
      'which services are deployed to AWS',
      'what is the cost of the storage account',
      // Plain conversation
      'hi',
      'thanks!',
      'tell me about openagentic',
    ])('does NOT trigger on: %s', (msg) => {
      const decision = evaluateUserIntent(msg);
      expect(decision.intent).toBeNull();
      expect(decision.reason).toBe('no-visual-signal');
    });
  });

  describe('edge cases', () => {
    it('handles empty input', () => {
      expect(evaluateUserIntent('').intent).toBeNull();
      expect(evaluateUserIntent('').reason).toBe('empty-message');
      expect(evaluateUserIntent(null).intent).toBeNull();
      expect(evaluateUserIntent(undefined).intent).toBeNull();
    });

    it('reports the matched signal for observability', () => {
      const decision = evaluateUserIntent('please render a sankey of cluster costs');
      expect(decision.intent).toBe('visualization');
      expect(decision.matched).toBeTruthy();
    });

    it('is case-insensitive', () => {
      expect(evaluateUserIntent('CREATE A CHART OF X').intent).toBe('visualization');
      expect(evaluateUserIntent('Create A Chart Of X').intent).toBe('visualization');
    });
  });
});
