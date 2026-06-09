import React, { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useDocsStore } from '@/stores/useDocsStore';
import { DocsCodeIcon } from '../components/DocsIcons';

/**
 * ApiRoutesPage — the HTTP route reference, SOURCE-READ from the generated
 * api-routes manifest (public/docs/generated/api-routes.json), which the docs
 * generator derives by scanning services/openagentic-api/src/routes for every
 * registered fastify.{get,post,put,patch,delete}(...) call. The route table,
 * the per-group routes, and the headline count all come from real source — no
 * hand-maintained route array (which had drifted to advertise fabricated
 * endpoints — e.g. an OpenAI-style chat-completions path and a conversations
 * resource — that the API never served; the real chat endpoint is the streaming
 * one and sessions live under the chat prefix). Each group below maps 1:1 to a
 * manifest section (a route
 * source file / area); the paths shown are exactly the paths registered in the
 * source.
 */

const methodColors: Record<string, { color: string; bg: string }> = {
  GET: { color: 'var(--color-info)', bg: 'color-mix(in srgb, var(--color-info) 12%, transparent)' },
  POST: { color: 'var(--color-success)', bg: 'color-mix(in srgb, var(--color-success) 12%, transparent)' },
  PUT: { color: 'var(--color-warning)', bg: 'color-mix(in srgb, var(--color-warning) 12%, transparent)' },
  PATCH: { color: 'var(--color-warning)', bg: 'color-mix(in srgb, var(--color-warning) 12%, transparent)' },
  DELETE: { color: 'var(--color-error)', bg: 'color-mix(in srgb, var(--color-error) 12%, transparent)' },
};

interface RenderRoute {
  method: string;
  path: string;
}

interface RenderGroup {
  id: string;
  title: string;
  routes: RenderRoute[];
}

const ApiRoutesPage: React.FC = () => {
  const { loadManifest, loadedManifests } = useDocsStore();

  useEffect(() => {
    if (!loadedManifests.has('api-routes')) {
      loadManifest('api-routes').catch(() => {});
    }
  }, [loadManifest, loadedManifests]);

  const manifest = loadedManifests.get('api-routes');

  // Route groups + paths SOURCE-READ from the generated manifest (one section
  // per route source-file / area). Method + path come straight from each item's
  // properties — the literal route registered in the API source.
  const groups = useMemo<RenderGroup[]>(() => {
    if (!manifest) return [];
    return manifest.sections
      .map((section) => {
        const routes = section.items
          .filter((item) => item.type === 'http-route')
          .map((item) => {
            const props = (item.properties ?? {}) as { method?: string; path?: string };
            return {
              method: (props.method ?? '').toUpperCase(),
              path: props.path ?? '',
            };
          })
          .filter((r) => r.method && r.path);
        return { id: section.id, title: section.title, routes };
      })
      .filter((g) => g.routes.length > 0);
  }, [manifest]);

  const totalRoutes = useMemo(() => groups.reduce((n, g) => n + g.routes.length, 0), [groups]);

  return (
    <div style={{ maxWidth: '960px', margin: '0 auto', padding: '48px 32px 96px' }}>
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }} style={{ marginBottom: '56px' }}>
        <div style={{ marginBottom: '20px' }}><DocsCodeIcon size={40} /></div>
        <h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--color-text)', marginBottom: '16px', letterSpacing: '-0.02em' }}>
          API Routes
        </h1>
        <p style={{ fontSize: '15px', color: 'var(--color-textSecondary)', lineHeight: 1.7, maxWidth: '680px' }}>
          {totalRoutes > 0 ? (
            <>
              A reference of the {totalRoutes} HTTP routes registered by the OpenAgentic API,
              generated directly from the API source — each entry is a real, registered route.
              For interactive testing and full request/response schemas, use the Swagger UI page.
            </>
          ) : (
            <>Loading the API route reference…</>
          )}
        </p>
      </motion.div>

      {groups.map((group, gi) => (
        <motion.section
          key={group.id}
          style={{ marginBottom: '40px' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 + gi * 0.03, duration: 0.4 }}
        >
          <h2 style={{ fontSize: '18px', fontWeight: 600, color: 'var(--color-text)', marginBottom: '12px' }}>{group.title}</h2>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: '12px', overflow: 'hidden' }}>
            {group.routes.map((route, i) => (
              <div
                key={`${route.method}-${route.path}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '12px 20px',
                  borderBottom: i < group.routes.length - 1 ? '1px solid var(--color-border)' : 'none',
                }}
              >
                <span
                  style={{
                    fontSize: '10px',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: '4px',
                    letterSpacing: '0.04em',
                    minWidth: '52px',
                    textAlign: 'center',
                    color: methodColors[route.method]?.color ?? 'var(--color-text)',
                    background: methodColors[route.method]?.bg ?? 'var(--color-surfaceSecondary)',
                  }}
                >
                  {route.method}
                </span>
                <code style={{ fontSize: '13px', fontFamily: 'var(--font-mono)', color: 'var(--color-text)', fontWeight: 500 }}>
                  {route.path}
                </code>
              </div>
            ))}
          </div>
        </motion.section>
      ))}
    </div>
  );
};

export default ApiRoutesPage;
