import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../utils/prisma.js';
import { CODING_ADAPTERS, listAdapters, getAdapter, type CodingAdapterId } from '../../services/coding-adapters/index.js';

const CONFIG_KEY = 'codemode.coding_adapter';

/** Called once on server boot: if CODING_ADAPTER env is set and the DB is
 *  empty (first boot from the wizard's .env), seed it. Otherwise the DB
 *  value wins so admins can change it from the UI without being stomped. */
export async function seedCodingAdapterFromEnv(): Promise<void> {
  const envValue = (process.env.CODING_ADAPTER || '').trim();
  if (!envValue) return;
  if (!getAdapter(envValue)) return;
  const existing = await prisma.systemConfiguration.findUnique({ where: { key: CONFIG_KEY } });
  if (existing) return; // don't overwrite admin's DB choice
  await prisma.systemConfiguration.create({
    data: { key: CONFIG_KEY, value: envValue as any },
  });
}

/**
 * Admin-facing endpoints to list coding CLI adapters and set the default.
 * Stored in SystemConfiguration under 'codemode.coding_adapter'. Defaults
 * to 'claude-code' (bundled in the exec image).
 */
export default async function codingAdaptersRoutes(fastify: FastifyInstance) {
  fastify.get('/admin/codemode/coding-adapters', async (_req: FastifyRequest, reply: FastifyReply) => {
    const row = await prisma.systemConfiguration.findUnique({ where: { key: CONFIG_KEY } });
    const current = (row?.value as CodingAdapterId | undefined) ?? (process.env.CODING_ADAPTER as CodingAdapterId | undefined) ?? 'claude-code';
    return reply.send({
      success: true,
      current,
      available: listAdapters(),
    });
  });

  fastify.put('/admin/codemode/coding-adapters', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as { adapter?: string };
    const adapter = getAdapter(body.adapter ?? '');
    if (!adapter) {
      return reply.code(400).send({
        success: false,
        error: 'Unknown coding adapter',
        available: listAdapters().map(a => a.id),
      });
    }
    await prisma.systemConfiguration.upsert({
      where: { key: CONFIG_KEY },
      update: { value: adapter.id as any },
      create: { key: CONFIG_KEY, value: adapter.id as any },
    });
    return reply.send({ success: true, current: adapter.id });
  });
}
