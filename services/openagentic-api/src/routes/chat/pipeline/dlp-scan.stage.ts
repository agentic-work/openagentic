import { PipelineStage, PipelineContext } from './pipeline.types.js';
import { getDLPScanner } from '../../../services/DLPScannerService.js';

/**
 * DLP Scan Stage (0.6.6 P2 / UC-A13)
 *
 * Scans the raw user message for credentials, PII, and other sensitive
 * patterns BEFORE the message is persisted, embedded, or handed to the LLM.
 *
 * Sits between Validation (priority 15) and Prompt (priority 35) so that
 * prompt assembly + memory writes see the redacted form only — never the
 * raw secret. The prior architecture relied on the upstream Azure AI
 * Foundry content filter as the last-line defense, which caused UC-A13
 * to fail: an AWS example key (AKIAIOSFODNN7EXAMPLE) echoed into the
 * stored user message and the assistant-side content filter's block
 * message surfaced instead of a clean redaction pill. This stage scrubs
 * at the platform edge where we control the outcome.
 */
export class DlpScanStage implements PipelineStage {
  readonly name = 'dlp-scan';
  readonly priority = 25;

  async execute(context: PipelineContext): Promise<PipelineContext> {
    const start = Date.now();
    const message = context.request?.message;
    if (!message || typeof message !== 'string') {
      return context;
    }

    const scanner = getDLPScanner(context.logger);
    const { text: cleaned, blocked, result } = scanner.scanAndAct(message, {
      userId: context.user?.id || 'anonymous',
      sessionId: context.session?.id,
      scanPoint: 'user_input',
    });

    if (result.findings.length === 0) {
      // Fast path — no findings, no event emitted, nothing in context changes.
      return context;
    }

    const summary = {
      findings: result.findings.length,
      severity: result.severity,
      action: result.action,
      categories: Array.from(new Set(result.findings.map(f => f.category))),
      rules: Array.from(new Set(result.findings.map(f => f.ruleId))),
      scanMs: result.scanTimeMs,
      totalMs: Date.now() - start,
    };

    if (blocked) {
      // BLOCK: refuse to forward the message to the LLM. Emit a
      // dlp_blocked event so the UI can render a structured refusal
      // instead of a generic "message blocked by content filters"
      // string from the upstream provider.
      context.logger.warn({
        ...summary,
        userId: context.user?.id,
        sessionId: context.session?.id,
      }, '[DLP] Pre-LLM scan BLOCKED user message');

      context.emit('dlp_blocked', {
        reason: 'Message contains disallowed content; refusing to send to LLM.',
        severity: result.severity,
        categories: summary.categories,
        rules: summary.rules,
      });

      context.aborted = true;
      context.errors = context.errors || [];
      context.errors.push({
        stage: this.name,
        code: 'DLP_BLOCK',
        message: `Message blocked by platform DLP policy (severity: ${result.severity})`,
        recoverable: false,
      } as any);
      return context;
    }

    // REDACT: mutate the request message + any persisted message array
    // so every downstream consumer (prompt assembly, memory store,
    // database upsert) sees only the scrubbed form.
    context.request.message = cleaned;
    if (Array.isArray(context.messages)) {
      for (let i = context.messages.length - 1; i >= 0; i--) {
        const m = context.messages[i];
        if (m?.role === 'user' && typeof m.content === 'string' && m.content === message) {
          m.content = cleaned;
          break;
        }
      }
    }

    context.logger.info({
      ...summary,
      userId: context.user?.id,
    }, '[DLP] Pre-LLM scan redacted user message');

    context.emit('dlp_scan_performed', {
      action: 'redact',
      severity: result.severity,
      findings: result.findings.length,
      categories: summary.categories,
      rules: summary.rules,
      scanPoint: 'user_input',
    });

    return context;
  }
}
