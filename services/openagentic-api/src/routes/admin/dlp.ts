/**
 * DLP Admin Routes — CRUD for rules, exemptions, audit log
 */
import { FastifyInstance } from 'fastify';
import { getDLPScanner } from '../../services/DLPScannerService.js';
import { prisma } from '../../utils/prisma.js';
import { enterpriseOnly } from '../../middleware/enterpriseOnly.js';

export default async function dlpRoutes(fastify: FastifyInstance) {
  const logger = fastify.log.child({ component: 'admin-dlp' }) as any;

  // OSS gate — all DLP admin routes return 402 with upgrade_url.
  fastify.addHook('preHandler', enterpriseOnly);

  // GET /admin/dlp/rules — List all rules with hit counts
  fastify.get('/dlp/rules', async (request, reply) => {
    const scanner = getDLPScanner(logger);
    const rules = scanner.getRules();

    // Get hit counts from DLPFinding table
    let hitCounts: Record<string, number> = {};
    try {
      const counts = await prisma.$queryRaw<Array<{rule_id: string, count: bigint}>>`
        SELECT rule_id, COUNT(*) as count FROM "DLPFinding" GROUP BY rule_id
      `;
      for (const row of counts) {
        hitCounts[row.rule_id] = Number(row.count);
      }
    } catch { /* table may not exist */ }

    return reply.send({
      rules: rules.map(r => ({
        id: r.id,
        category: r.category,
        name: r.name,
        description: r.description,
        pattern: r.pattern.source,
        flags: r.pattern.flags,
        severity: r.severity,
        enabled: r.enabled,
        hits: hitCounts[r.id] || 0,
      })),
      summary: scanner.getRuleSummary(),
    });
  });

  // GET /admin/dlp/config — Full DLP configuration status
  fastify.get('/dlp/config/status', async (request, reply) => {
    const scanner = getDLPScanner(logger);
    const rules = scanner.getRules();
    return reply.send({
      globalDisabled: scanner.isGlobalDisabled(),
      totalRules: rules.length,
      enabledRules: rules.filter(r => r.enabled).length,
      disabledRules: rules.filter(r => !r.enabled).length,
      exemptions: scanner.getExemptions().length,
      categories: scanner.getRuleSummary(),
    });
  });

  // PUT /admin/dlp/global — Global DLP enable/disable switch
  fastify.put<{ Body: { disabled: boolean } }>('/dlp/global', async (request, reply) => {
    const scanner = getDLPScanner(logger);
    const { disabled } = request.body;
    await scanner.setGlobalDisabled(!!disabled);
    logger.info({ disabled }, '[DLP Admin] Global DLP scanning toggled');
    return reply.send({ success: true, globalDisabled: scanner.isGlobalDisabled() });
  });

  // PUT /admin/dlp/category/:category — Toggle entire category
  fastify.put<{ Params: { category: string }; Body: { enabled: boolean } }>(
    '/dlp/category/:category', async (request, reply) => {
      const scanner = getDLPScanner(logger);
      const { category } = request.params;
      const { enabled } = request.body;
      await scanner.toggleCategory(category as any, enabled);
      return reply.send({ success: true, category, enabled });
    }
  );

  // PUT /admin/dlp/rules/:id — Toggle or update severity
  fastify.put<{ Params: { id: string }; Body: { enabled?: boolean; severity?: string } }>(
    '/dlp/rules/:id', async (request, reply) => {
      const scanner = getDLPScanner(logger);
      const { id } = request.params;
      const { enabled, severity } = request.body || {};

      if (enabled !== undefined) {
        const ok = await scanner.toggleRule(id, enabled);
        if (!ok) return reply.code(404).send({ error: 'Rule not found' });
      }
      if (severity) {
        const ok = await scanner.updateRuleSeverity(id, severity as any);
        if (!ok) return reply.code(404).send({ error: 'Rule not found' });
      }

      return reply.send({ success: true });
    }
  );

  // GET /admin/dlp/exemptions
  fastify.get('/dlp/exemptions', async (request, reply) => {
    const scanner = getDLPScanner(logger);
    return reply.send({ exemptions: scanner.getExemptions() });
  });

  // POST /admin/dlp/exemptions
  fastify.post<{ Body: { toolPattern: string; scanPoint: string; exemptCategories: string[]; reason: string } }>(
    '/dlp/exemptions', async (request, reply) => {
      const scanner = getDLPScanner(logger);
      const { toolPattern, scanPoint, exemptCategories, reason } = request.body;
      const exemption = await scanner.addExemption({
        toolPattern,
        scanPoint: scanPoint as any,
        exemptCategories: exemptCategories as any[],
        reason: reason || '',
        enabled: true,
      });
      return reply.send({ exemption });
    }
  );

  // DELETE /admin/dlp/exemptions/:id
  fastify.delete<{ Params: { id: string } }>('/dlp/exemptions/:id', async (request, reply) => {
    const scanner = getDLPScanner(logger);
    const ok = await scanner.removeExemption(request.params.id);
    if (!ok) return reply.code(404).send({ error: 'Exemption not found' });
    return reply.send({ success: true });
  });

  // GET /admin/dlp/audit-log
  fastify.get<{ Querystring: { limit?: string; offset?: string; severity?: string; action?: string; tool?: string; days?: string } }>(
    '/dlp/audit-log', async (request, reply) => {
      const { limit = '50', offset = '0', severity, action, tool, days = '7' } = request.query;

      const since = new Date();
      since.setDate(since.getDate() - parseInt(days));

      try {
        const where: any = { timestamp: { gte: since } };
        if (severity) where.severity = severity;
        if (action) where.action_taken = action;
        if (tool) where.context = { path: ['toolName'], equals: tool };

        const [findings, total] = await Promise.all([
          prisma.dLPFinding.findMany({
            where,
            orderBy: { timestamp: 'desc' },
            take: parseInt(limit),
            skip: parseInt(offset),
          }),
          prisma.dLPFinding.count({ where }),
        ]);

        // Resolve user display names
        const userIds = [...new Set(findings.map(f => f.user_id).filter(Boolean))];
        const userMap = new Map<string, string>();
        if (userIds.length > 0) {
          try {
            const users = await prisma.user.findMany({
              where: { id: { in: userIds } },
              select: { id: true, name: true, email: true },
            });
            for (const u of users) {
              userMap.set(u.id, u.name || u.email?.split('@')[0] || u.id);
            }
          } catch { /* user table may differ */ }
        }

        const events = findings.map(f => ({
          id: f.id,
          timestamp: f.timestamp,
          toolName: (f.context as any)?.toolName || 'unknown',
          scanPoint: f.scan_point,
          action: f.action_taken,
          severity: f.severity,
          category: f.category,
          ruleName: (f.context as any)?.ruleName || f.rule_id,
          ruleId: f.rule_id,
          matchSnippet: (f.context as any)?.matchSnippet || '',
          userId: f.user_id,
          userName: userMap.get(f.user_id) || f.user_id?.replace('azure_', '').substring(0, 12) || 'unknown',
          sessionId: f.session_id,
          model: (f.context as any)?.model || undefined,
        }));

        // Compute summary stats for the diagram
        const actionCounts = { allow: 0, redact: 0, block: 0 };
        const categoryCounts: Record<string, number> = {};
        for (const e of events) {
          actionCounts[e.action as keyof typeof actionCounts] = (actionCounts[e.action as keyof typeof actionCounts] || 0) + 1;
          categoryCounts[e.category] = (categoryCounts[e.category] || 0) + 1;
        }

        return reply.send({
          events,
          total,
          limit: parseInt(limit),
          offset: parseInt(offset),
          stats: { actionCounts, categoryCounts },
        });
      } catch (error: any) {
        logger.warn({ error: error.message }, '[DLP] Audit log query failed');
        return reply.send({ events: [], total: 0, limit: 50, offset: 0, error: error.message });
      }
    }
  );

  // GET /admin/dlp/config
  fastify.get('/dlp/config', async (request, reply) => {
    const scanner = getDLPScanner(logger);
    return reply.send({
      rulesCount: scanner.getRules().length,
      enabledCount: scanner.getRules().filter(r => r.enabled).length,
      exemptionsCount: scanner.getExemptions().length,
      summary: scanner.getRuleSummary(),
    });
  });

  // GET /admin/dlp/ai-summary — Agent-generated DLP status summary
  fastify.get('/dlp/ai-summary', async (request, reply) => {
    try {
      const scanner = getDLPScanner(logger);
      const rules = scanner.getRules();
      const exemptions = scanner.getExemptions();
      const ruleSummary = scanner.getRuleSummary();

      // Get recent findings stats
      const since = new Date();
      since.setDate(since.getDate() - 7);
      let recentStats = { total: 0, blocked: 0, redacted: 0, topRules: [] as string[] };
      try {
        const findings = await prisma.dLPFinding.findMany({
          where: { timestamp: { gte: since } },
          select: { action_taken: true, rule_id: true, category: true },
        });
        recentStats.total = findings.length;
        recentStats.blocked = findings.filter(f => f.action_taken === 'block').length;
        recentStats.redacted = findings.filter(f => f.action_taken === 'redact').length;
        // Top triggered rules
        const ruleCounts: Record<string, number> = {};
        for (const f of findings) { ruleCounts[f.rule_id] = (ruleCounts[f.rule_id] || 0) + 1; }
        recentStats.topRules = Object.entries(ruleCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id, count]) => {
          const rule = rules.find(r => r.id === id);
          return `${rule?.name || id}: ${count} hits`;
        });
      } catch { /* table may not exist */ }

      // Build a concise context for the LLM (keep tokens low)
      const context = [
        `DLP Status: ${rules.length} rules (${rules.filter(r => r.enabled).length} enabled), ${exemptions.length} exemptions`,
        `Categories: ${Object.entries(ruleSummary).map(([k, v]) => `${k}(${v})`).join(', ')}`,
        `Last 7d: ${recentStats.total} events, ${recentStats.blocked} blocked, ${recentStats.redacted} redacted`,
        recentStats.topRules.length > 0 ? `Top triggered: ${recentStats.topRules.join('; ')}` : 'No findings in last 7 days',
        exemptions.length > 0 ? `Exemptions: ${exemptions.map(e => `${e.toolPattern}/${e.scanPoint} skips ${e.exemptCategories.join(',')}`).join('; ')}` : 'No exemptions',
      ].join('\n');

      // Use Ollama directly for the summary (lightweight, always available)
      const http = await import('http');
      const ollamaUrl = process.env.OLLAMA_BASE_URL || 'http://10.2.10.142:11434';
      const model = process.env.DEFAULT_MODEL || 'gpt-oss';
      const summaryText = await new Promise<string>((resolve) => {
        const postData = JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are a security analyst. Write a 3-4 sentence executive summary of the DLP system status. Be concise and factual. No markdown.' },
            { role: 'user', content: context },
          ],
          stream: false,
          options: { num_predict: 200, temperature: 0.3 },
        });
        const url = new URL(`${ollamaUrl}/api/chat`);
        const req = http.request({
          hostname: url.hostname, port: url.port,
          path: url.pathname, method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }, (res: any) => {
          let body = '';
          res.on('data', (c: string) => body += c);
          res.on('end', () => {
            try {
              const data = JSON.parse(body);
              resolve(data?.message?.content || 'No summary generated.');
            } catch { resolve('Failed to parse LLM response.'); }
          });
        });
        req.on('error', (e: Error) => resolve(`LLM unavailable: ${e.message}`));
        req.write(postData);
        req.end();
        setTimeout(() => resolve('Summary generation timed out.'), 30000);
      });

      return reply.send({ summary: summaryText, context });
    } catch (error: any) {
      logger.warn({ error: error.message }, '[DLP] AI summary generation failed');
      return reply.send({ summary: `DLP system is active with ${getDLPScanner(logger).getRules().length} rules. Unable to generate AI summary: ${error.message}`, error: error.message });
    }
  });
}
