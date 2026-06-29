/**
 * Admin MCP Inspector Proxy
 *
 * Provides secure, authenticated access to the MCP Inspector web UI
 * Only accessible to admin users through the admin portal
 *
 * Architecture:
 * - MCP Inspector UI runs on localhost:6274 inside mcp-proxy container
 * - MCPP Server (WebSocket) runs on localhost:6277 inside mcp-proxy container
 * - We proxy HTTP to localhost:6274 via mcp-proxy:8080 (which internally proxies to 6274)
 * - We proxy WebSocket to mcp-proxy:6277 for MCPP connections
 */

import { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import fetch from 'node-fetch';
import WebSocket from 'ws';
import { adminMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';

const logger = loggers.routes;

const MCP_PROXY_URL = process.env.MCP_PROXY_URL || 'http://mcp-proxy:8080';
const MCP_PROXY_HOST = process.env.MCP_PROXY_HOST || 'mcp-proxy';
// MCPP server port - the Inspector's WebSocket server for MCP protocol
const MCP_INSPECTOR_MCPP_PORT = process.env.MCP_INSPECTOR_MCPP_PORT || '6277';

/**
 * Handle MCP Inspector homepage - fetch and rewrite HTML
 */
async function handleInspectorHomepage(request: FastifyRequest, reply: FastifyReply) {
  try {
    logger.debug('Fetching MCP Inspector homepage');

    // Get the authenticated admin user's token
    const user = (request as any).user;
    const userToken = user?.accessToken;

    const headers: any = {};
    if (userToken) {
      headers['authorization'] = `Bearer ${userToken}`;
    }

    const proxyResponse = await fetch(MCP_PROXY_URL, {
      method: 'GET',
      headers,
    });

    let html = await proxyResponse.text();

    // Determine the WebSocket proxy URL for MCPP connections
    // In production, this will be wss://hostname/api/admin/mcp-inspector/mcpp
    const protocol = request.headers['x-forwarded-proto'] || 'http';
    const host = request.headers['x-forwarded-host'] || request.headers.host || 'localhost';
    const wsProtocol = protocol === 'https' ? 'wss' : 'ws';
    const mcppProxyUrl = `${wsProtocol}://${host}/api/admin/mcp-inspector/mcpp`;

    // Inject a script before </head> to configure the MCP Inspector
    // The Inspector supports connecting to servers via:
    // 1. stdio - Run MCP server as subprocess
    // 2. sse - Connect to SSE endpoint
    // 3. streamable-http - Connect to HTTP streaming endpoint
    //
    // Our mcp-proxy exposes MCP tools via HTTP POST /mcp endpoint
    // We'll configure the Inspector to use SSE transport pointing to our proxy
    const mcpProxyHttpUrl = `${protocol}://${host}/api/admin/mcp-inspector/mcp-sse`;

    const configScript = `
<script>
  // Injected by OpenAgentic admin proxy to configure MCP Inspector
  (function() {
    var mcppProxyUrl = '${mcppProxyUrl}';
    var mcpHttpUrl = '${mcpProxyHttpUrl}';

    console.log('[OpenAgentic] MCP Inspector Configuration:');
    console.log('  MCPP WebSocket URL:', mcppProxyUrl);
    console.log('  MCP HTTP URL:', mcpHttpUrl);

    // Pre-configure localStorage for faster startup
    try {
      localStorage.setItem('MCP_PROXY_FULL_ADDRESS', mcppProxyUrl);
      // Store connection hints for the Inspector - servers will be fetched dynamically
      localStorage.setItem('openagentic_mcp_config', JSON.stringify({
        mcppUrl: mcppProxyUrl,
        httpUrl: mcpHttpUrl,
        servers: [] // Populated dynamically from /api/mcp/servers
      }));
    } catch(e) {
      console.warn('[OpenAgentic] Could not save to localStorage:', e);
    }

    // Add URL param for MCPP if not present
    var url = new URL(window.location.href);
    if (!url.searchParams.has('MCP_PROXY_FULL_ADDRESS')) {
      url.searchParams.set('MCP_PROXY_FULL_ADDRESS', mcppProxyUrl);
      history.replaceState(null, '', url.toString());
    }

    // Dynamically fetch available MCP servers
    fetch('/api/mcp/servers')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        var servers = data.servers || [];
        console.log('[OpenAgentic] Available MCP servers:', servers.map(function(s) { return s.name || s.id; }));
        try {
          var config = JSON.parse(localStorage.getItem('openagentic_mcp_config') || '{}');
          config.servers = servers.map(function(s) { return s.id || s.name; });
          localStorage.setItem('openagentic_mcp_config', JSON.stringify(config));
        } catch(e) { console.warn('Could not update server list:', e); }
      })
      .catch(function(e) { console.warn('[OpenAgentic] Could not fetch MCP servers:', e); });

    console.log('[OpenAgentic] MCP Inspector ready. Servers are discovered dynamically.');
    console.log('[OpenAgentic] To connect to an MCP server, select "stdio" transport and enter the server command.');
  })();
</script>
`;
    html = html.replace('</head>', configScript + '</head>');

    // Rewrite URLs to go through the proxy
    html = html
      .replace(/href="\/(?!api\/admin\/mcp-inspector)/g, 'href="/api/admin/mcp-inspector/')
      .replace(/src="\/(?!api\/admin\/mcp-inspector)/g, 'src="/api/admin/mcp-inspector/')
      .replace(/window\.location\.href='\/(?!api\/admin\/mcp-inspector)/g, "window.location.href='/api/admin/mcp-inspector/")
      .replace(/window\.location\.href="\/(?!api\/admin\/mcp-inspector)/g, 'window.location.href="/api/admin/mcp-inspector/')
      .replace(/fetch\('\/(?!api\/admin\/mcp-inspector)/g, "fetch('/api/admin/mcp-inspector/")
      .replace(/fetch\("\/(?!api\/admin\/mcp-inspector)/g, 'fetch("/api/admin/mcp-inspector/');

    reply.type('text/html').send(html);

  } catch (error) {
    logger.error({ error }, 'Failed to fetch MCP Inspector homepage');
    reply.code(500).send({
      error: 'Failed to connect to MCP Inspector',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

const adminMCPInspectorRoutes: FastifyPluginAsync = async (fastify) => {

  /**
   * GET /api/admin/mcp-inspector
   * Serve the MCP Inspector homepage with URL rewriting
   * REQUIRES: Admin authentication
   */
  fastify.get('/mcp-inspector', { onRequest: adminMiddleware }, async (request, reply) => {
    return handleInspectorHomepage(request, reply);
  });

  /**
   * GET /api/admin/mcp-inspector/ (trailing slash)
   * Same as above, handles trailing slash variant
   */
  fastify.get('/mcp-inspector/', { onRequest: adminMiddleware }, async (request, reply) => {
    return handleInspectorHomepage(request, reply);
  });

  /**
   * Proxy static assets (CSS, JS, images) without authentication
   * These are public MCP Inspector UI assets, not sensitive data
   * GET /api/admin/mcp-inspector/assets/* -> http://mcp-proxy:8080/assets/*
   */
  fastify.get('/mcp-inspector/assets/*', async (request, reply) => {
    try {
      // Extract the path after /mcp-inspector/ (accounting for /api/admin prefix)
      // request.url contains full path like /api/admin/mcp-inspector/assets/index.js
      const path = request.url.replace(/^.*\/mcp-inspector\//, '').split('?')[0];
      const queryString = request.url.includes('?') ? '?' + request.url.split('?')[1] : '';
      const targetUrl = `${MCP_PROXY_URL}/${path}${queryString}`;

      logger.debug({ requestUrl: request.url, path, targetUrl }, 'Proxying static asset request to MCP Inspector');

      const proxyResponse = await fetch(targetUrl, {
        method: 'GET',
        headers: {
          'host': 'mcp-proxy:8080',
        },
      });

      // Get response body as buffer for binary assets
      const body = await proxyResponse.buffer();

      // Forward response headers
      proxyResponse.headers.forEach((value, key) => {
        if (!['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
          reply.header(key, value);
        }
      });

      reply.code(proxyResponse.status).send(body);

    } catch (error) {
      logger.error({ error }, 'Failed to proxy static asset to MCP Inspector');
      reply.code(500).send({
        error: 'Failed to load asset',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Proxy all other requests to MCP Inspector
   * GET /api/admin/mcp-inspector/* -> http://mcp-proxy:8080/*
   * REQUIRES: Admin authentication
   */
  fastify.all('/mcp-inspector/*', { onRequest: adminMiddleware }, async (request, reply) => {
    try {
      // Extract the path after /mcp-inspector/ (accounting for /api/admin prefix)
      // request.url contains full path like /api/admin/mcp-inspector/something
      const path = request.url.replace(/^.*\/mcp-inspector\//, '').split('?')[0];
      const queryString = request.url.includes('?') ? '?' + request.url.split('?')[1] : '';
      const targetUrl = path === '' ? MCP_PROXY_URL : `${MCP_PROXY_URL}/${path}${queryString}`;

      logger.debug({ targetUrl, method: request.method, path }, 'Proxying request to MCP Inspector');

      // Get the authenticated admin user's token from the request
      const user = (request as any).user;
      const userToken = user?.accessToken;

      // Build headers for mcp-proxy request
      const proxyHeaders: any = {
        'host': 'mcp-proxy:8080',
      };

      // Copy content-type if present
      if (request.headers['content-type']) {
        proxyHeaders['content-type'] = request.headers['content-type'];
      }

      // If we have the user's access token, pass it to mcp-proxy for auth
      if (userToken) {
        proxyHeaders['authorization'] = `Bearer ${userToken}`;
      }

      // Forward the request to mcp-proxy
      const proxyResponse = await fetch(targetUrl, {
        method: request.method,
        headers: proxyHeaders,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? JSON.stringify(request.body) : undefined,
      });

      // Get response body
      const contentType = proxyResponse.headers.get('content-type') || '';
      let body;

      if (contentType.includes('application/json')) {
        body = await proxyResponse.json();
      } else if (contentType.includes('text/')) {
        body = await proxyResponse.text();
      } else {
        body = await proxyResponse.buffer();
      }

      // Forward response headers
      proxyResponse.headers.forEach((value, key) => {
        // Skip headers that shouldn't be forwarded
        if (!['content-encoding', 'transfer-encoding', 'connection'].includes(key.toLowerCase())) {
          reply.header(key, value);
        }
      });

      // Send response
      reply.code(proxyResponse.status).send(body);

    } catch (error) {
      logger.error({ error }, 'Failed to proxy request to MCP Inspector');
      reply.code(500).send({
        error: 'Failed to connect to MCP Inspector',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * WebSocket proxy for MCP Inspector MCPP server
   * WS /api/admin/mcp-inspector/mcpp
   * Proxies WebSocket connections to mcp-proxy:6277 (MCPP server)
   * REQUIRES: Admin authentication
   */
  fastify.get('/mcp-inspector/mcpp', {
    websocket: true,
    onRequest: adminMiddleware as any
  } as any, (connection: any, req: any) => {
    const clientWs = connection.socket;
    const user = (req as any).user;
    const userId = user?.userId || 'anonymous';

    logger.info({ userId }, 'MCP Inspector WebSocket connection initiated');

    // Connect to the MCPP server inside mcp-proxy container
    const mcppUrl = `ws://${MCP_PROXY_HOST}:${MCP_INSPECTOR_MCPP_PORT}`;
    logger.info({ mcppUrl, userId }, 'Connecting to MCPP server');

    let serverWs: WebSocket | null = null;

    try {
      serverWs = new WebSocket(mcppUrl);

      // Handle connection to MCPP server
      serverWs.on('open', () => {
        logger.info({ userId, mcppUrl }, 'Connected to MCPP server');
        clientWs.send(JSON.stringify({
          type: 'proxy_connected',
          message: 'Connected to MCP Inspector MCPP server'
        }));
      });

      // Forward messages from MCPP server to client
      serverWs.on('message', (data: any) => {
        if (clientWs.readyState === 1) { // WebSocket.OPEN
          clientWs.send(data);
        }
      });

      // Handle MCPP server errors
      serverWs.on('error', (error: Error) => {
        logger.error({ error: error.message, userId }, 'MCPP server WebSocket error');
        if (clientWs.readyState === 1) {
          clientWs.send(JSON.stringify({
            type: 'error',
            error: 'MCPP server connection error',
            message: error.message
          }));
        }
      });

      // Handle MCPP server close
      serverWs.on('close', (code: number, reason: Buffer) => {
        logger.info({ userId, code, reason: reason.toString() }, 'MCPP server connection closed');
        if (clientWs.readyState === 1) {
          clientWs.close(code, reason.toString());
        }
      });

    } catch (error: any) {
      logger.error({ error: error.message, userId }, 'Failed to connect to MCPP server');
      clientWs.send(JSON.stringify({
        type: 'error',
        error: 'Failed to connect to MCPP server',
        message: error.message
      }));
      clientWs.close(1011, 'Failed to connect to upstream MCPP server');
      return;
    }

    // Forward messages from client to MCPP server
    clientWs.on('message', (data: any) => {
      if (serverWs && serverWs.readyState === 1) { // WebSocket.OPEN
        serverWs.send(data);
      }
    });

    // Handle client disconnect
    clientWs.on('close', () => {
      logger.info({ userId }, 'Client WebSocket closed');
      if (serverWs) {
        serverWs.close();
      }
    });

    // Handle client errors
    clientWs.on('error', (error: any) => {
      logger.error({ error: error.message, userId }, 'Client WebSocket error');
      if (serverWs) {
        serverWs.close();
      }
    });
  });

  logger.info('MCP Inspector routes registered with WebSocket proxy support');
};

export default adminMCPInspectorRoutes;
