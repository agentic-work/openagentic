/**
 * Favicon Proxy Route
 *
 * your environment-airgap safe favicon fetcher. Before this route, toolSummarizer used
 * https://www.google.com/s2/favicons?domain=... directly — Palo Alto
 * TLS-decrypt breaks that silently in your environment, and it leaks every URL the
 * user visits through tools out to Google.
 *
 * GET /api/favicon?domain=example.com
 *   → returns the favicon image bytes, cached in Redis 24h
 *   → on miss / fetch failure returns a small neutral placeholder SVG
 *
 * See agentic-work/openagentic-your-deployment#330 (Tier 3).
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getRedisClient } from '../utils/redis-client.js';

const CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h
const FETCH_TIMEOUT_MS = 4000;
const MAX_BYTES = 32 * 1024; // 32KB — favicons are tiny; anything bigger is sus

const PLACEHOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">' +
  '<rect width="16" height="16" rx="3" fill="#8b949e" opacity="0.35"/>' +
  '<circle cx="8" cy="8" r="2.5" fill="#8b949e" opacity="0.9"/>' +
  '</svg>';

// Minimal domain validator — blocks obvious SSRF (file://, internal IPs, etc.)
// Allows a-z 0-9 dot dash, max 253 chars, at least one dot.
const DOMAIN_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;

// Blocklist — prevents the proxy from being used to fetch internal IPs even
// if they somehow pass the DNS validator.
const BLOCKED_HOSTS = [
  'localhost', '127.0.0.1', '0.0.0.0',
  '10.', '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.',
  '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.', '172.28.',
  '172.29.', '172.30.', '172.31.', '192.168.',
];

function isBlockedHost(domain: string): boolean {
  const lower = domain.toLowerCase();
  return BLOCKED_HOSTS.some(p => lower === p || lower.startsWith(p));
}

async function fetchFavicon(domain: string): Promise<{ bytes: Buffer; contentType: string } | null> {
  // Try a handful of conventional locations — prefer HTTPS.
  const candidates = [
    `https://${domain}/favicon.ico`,
    `https://www.${domain}/favicon.ico`,
    `https://${domain}/favicon.png`,
  ];
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    for (const url of candidates) {
      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          redirect: 'follow',
          headers: { 'User-Agent': 'openagentic-favicon/1.0' },
        });
        if (!res.ok) continue;
        const contentType = res.headers.get('content-type') || 'image/x-icon';
        if (!contentType.startsWith('image/')) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length === 0 || buf.length > MAX_BYTES) continue;
        return { bytes: buf, contentType };
      } catch {
        // try next candidate
      }
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const faviconRoutes = async (fastify: FastifyInstance) => {
  const redis = getRedisClient();

  fastify.get('/api/favicon', async (
    request: FastifyRequest<{ Querystring: { domain?: string } }>,
    reply: FastifyReply,
  ) => {
    const domainRaw = (request.query?.domain || '').trim().toLowerCase();
    if (!domainRaw || !DOMAIN_RE.test(domainRaw) || isBlockedHost(domainRaw)) {
      // Bad input → placeholder. We DON'T 400 here because the pill row in
      // the UI treats an empty favicon as "no icon" — still returning an
      // image keeps the layout consistent.
      reply.header('cache-control', 'public, max-age=300');
      reply.header('content-type', 'image/svg+xml');
      return reply.send(PLACEHOLDER_SVG);
    }

    const cacheKey = `favicon:${domainRaw}`;

    // Redis hit?
    try {
      const cached = await redis.get<{ b64: string; ct: string }>(cacheKey);
      if (cached?.b64 && cached?.ct) {
        reply.header('cache-control', `public, max-age=${CACHE_TTL_SECONDS}`);
        reply.header('content-type', cached.ct);
        return reply.send(Buffer.from(cached.b64, 'base64'));
      }
    } catch (err) {
      fastify.log.warn({ err, domain: domainRaw }, '[favicon] redis get failed');
    }

    // Upstream fetch
    const fetched = await fetchFavicon(domainRaw);
    if (!fetched) {
      // Negative cache a shorter TTL so a failing domain doesn't re-fetch
      // on every single chat message.
      try {
        await redis.set(cacheKey, { b64: Buffer.from(PLACEHOLDER_SVG).toString('base64'), ct: 'image/svg+xml' }, 60 * 60);
      } catch {}
      reply.header('cache-control', 'public, max-age=3600');
      reply.header('content-type', 'image/svg+xml');
      return reply.send(PLACEHOLDER_SVG);
    }

    try {
      await redis.set(
        cacheKey,
        { b64: fetched.bytes.toString('base64'), ct: fetched.contentType },
        CACHE_TTL_SECONDS,
      );
    } catch (err) {
      fastify.log.warn({ err, domain: domainRaw }, '[favicon] redis set failed');
    }

    reply.header('cache-control', `public, max-age=${CACHE_TTL_SECONDS}`);
    reply.header('content-type', fetched.contentType);
    return reply.send(fetched.bytes);
  });
};
