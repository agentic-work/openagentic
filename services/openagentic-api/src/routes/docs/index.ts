/**
 * Documentation routes - redirects to separate documentation service
 */

import { FastifyPluginAsync } from 'fastify';

export const docsRoutes: FastifyPluginAsync = async (fastify) => {
  // Redirect to the documentation service
  fastify.get('/docs', async (request, reply) => {
    // Get the host from the request
    const host = request.headers.host?.replace(':8000', '') || 'localhost';
    const protocol = request.headers['x-forwarded-proto'] || 'http';
    
    // Redirect to the documentation service on port 3006 or via nginx
    const docsUrl = process.env.DOCS_URL || `${protocol}://${host}:3006`;
    
    return reply.redirect(docsUrl);
  });

  // Provide information about the documentation service
  fastify.get('/docs/info', async (request, reply) => {
    return reply.send({
      message: 'Documentation is served by a separate container',
      url: process.env.DOCS_URL || 'http://localhost:3006',
      description: 'Comprehensive documentation for OpenAgentic Chat',
      features: [
        'API Documentation',
        'UI Component Guide',
        'MCP Orchestrator Deep Dive',
        'Infrastructure Overview',
        'Deployment Guides'
      ]
    });
  });
};