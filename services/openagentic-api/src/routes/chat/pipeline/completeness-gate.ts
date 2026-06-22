/**
 * Completeness Gate — Layer 3 of the ReAct+Reflection cognitive loop.
 *
 * After the tool loop ends, verifies the response addresses EVERY part
 * of the user's request. Separate from Phase 2 (hallucination/accuracy check)
 * — this checks coverage, not correctness.
 *
 * Single conditional LLM call (~600 tokens). Only fires for multi-part
 * queries with 2+ tool calls. Feature-flagged via COMPLETENESS_GATE_ENABLED.
 */

export interface CompletenessResult {
  isComplete: boolean;
  missingParts: string[];
  confidence: number;
}

// Signals that indicate a multi-part user request
const MULTI_PART_SIGNALS = [
  / and /i,
  / also /i,
  / additionally /i,
  / plus /i,
  / as well as /i,
  /\d+\.\s/,          // Numbered list items
  /\?\s*.*\?/,        // Multiple question marks
];

export class CompletenessGate {

  /**
   * Cheap heuristic pre-check — returns false for simple queries.
   * No LLM call. Expected to filter out ~75-85% of conversations.
   */
  static shouldCheck(
    userMessage: string,
    mcpCallCount: number,
    wasMaxRoundsForced: boolean,
    alreadySelfCritiqued: boolean,
  ): boolean {
    // Feature flag
    if (process.env.COMPLETENESS_GATE_ENABLED === 'false') return false;

    // Simple queries — no need
    if (mcpCallCount < 2) return false;

    // Already forced synthesis at max rounds — response is best-effort
    if (wasMaxRoundsForced) return false;

    // Phase 2 already revised — avoid double-revision
    if (alreadySelfCritiqued) return false;

    // Count multi-part signals in user message
    let signals = 0;
    for (const pattern of MULTI_PART_SIGNALS) {
      if (pattern.test(userMessage)) signals++;
    }

    // Comma-separated items (e.g., "show me A, B, and C")
    const commaCount = (userMessage.match(/,/g) || []).length;
    if (commaCount >= 2) signals++;

    return signals >= 2;
  }

  /**
   * Single non-streaming LLM call to evaluate response completeness.
   * Returns structured assessment with missing parts.
   */
  static async check(
    completionService: any,
    model: string,
    userMessage: string,
    assistantResponse: string,
    toolSummary: string,
    logger: any,
  ): Promise<CompletenessResult> {
    const messages = [
      {
        role: 'system' as const,
        content:
          'You are evaluating whether a response fully addresses a user\'s request. ' +
          'Respond with JSON only: {"isComplete": true/false, "missingParts": ["description of missing part"], "confidence": 0.0-1.0}',
      },
      {
        role: 'user' as const,
        content:
          `User asked: "${userMessage}"\n\n` +
          `Assistant responded:\n${assistantResponse.substring(0, 2000)}\n\n` +
          `Tool data summary: ${toolSummary}\n\n` +
          'Does the response address EVERY part of the request? List any missing parts.',
      },
    ];

    const stream = await completionService.createCompletion({
      model,
      messages,
      temperature: 0.1,
      max_tokens: 256,
      stream: false,
    });

    // Extract response (same pattern as Phase 2 self-critique)
    let raw = '';
    if (stream && typeof stream === 'object') {
      if (Symbol.asyncIterator in stream) {
        for await (const chunk of stream as AsyncIterable<any>) {
          if (chunk?.content) raw += chunk.content;
          else if (chunk?.choices?.[0]?.delta?.content) raw += chunk.choices[0].delta.content;
          else if (typeof chunk === 'string') raw += chunk;
        }
      } else if ('content' in stream) {
        raw = (stream as any).content || '';
      } else if ((stream as any).choices?.[0]?.message?.content) {
        raw = (stream as any).choices[0].message.content;
      }
    }

    // Parse JSON response
    try {
      // Strip markdown code fences if present
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        isComplete: !!parsed.isComplete,
        missingParts: Array.isArray(parsed.missingParts) ? parsed.missingParts : [],
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      };
    } catch (parseErr) {
      logger.warn({ raw: raw.substring(0, 200) }, '[COMPLETENESS] Failed to parse LLM response as JSON');
      // Assume complete if we can't parse — don't block the response
      return { isComplete: true, missingParts: [], confidence: 0.5 };
    }
  }
}
