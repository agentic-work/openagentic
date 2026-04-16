import Fastify from 'fastify';
import cors from '@fastify/cors';
import { logger } from './utils/logger';
import { getRedis, closeRedis } from './utils/redis';
import { AgentOrchestrator } from './services/AgentOrchestrator';
import { BackgroundAgentManager } from './services/BackgroundAgentManager';
import { SkillsRegistry } from './services/SkillsRegistry';
import { MCPBridge } from './tools/MCPBridge';
import { healthRoutes } from './routes/health';
import { executeRoutes } from './routes/execute';
import { streamRoutes } from './routes/stream';
import { definitionRoutes } from './routes/definitions';
import { backgroundRoutes } from './routes/background';
import { skillsRoutes } from './routes/skills';
import { executionRoutes } from './routes/executions';
import resolveRoutes from './routes/resolve';
import { register, onRequestHook, onResponseHook } from './metrics';

const PORT = parseInt(process.env.PORT || '3300', 10);
const MCP_PROXY_URL = process.env.MCP_PROXY_URL || 'http://openagentic-mcp-proxy:5001';
const API_URL = process.env.API_URL || 'http://openagentic-api:8000';

async function main() {
  const app = Fastify({
    logger: false,
    bodyLimit: 10 * 1024 * 1024, // 10MB
  });

  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  // Prometheus metrics hooks
  app.addHook('onRequest', onRequestHook);
  app.addHook('onResponse', onResponseHook);

  // Prometheus metrics endpoint
  app.get('/metrics', async (_request, reply) => {
    const metrics = await register.metrics();
    reply.header('Content-Type', register.contentType).send(metrics);
  });

  // Initialize services
  const mcpBridge = new MCPBridge({ mcpProxyUrl: MCP_PROXY_URL, timeout: 30000 });
  const orchestrator = new AgentOrchestrator(mcpBridge, API_URL);
  const bgManager = new BackgroundAgentManager(mcpBridge, API_URL);
  const skillsRegistry = new SkillsRegistry(API_URL);

  // Load skills from API (non-blocking — continues even if API is not yet ready)
  skillsRegistry.loadFromAPI().catch(err => {
    logger.warn({ err: err.message }, 'Initial skills load failed — will retry on first access');
  });

  // Connect Redis
  try {
    const redis = getRedis();
    await redis.connect();
    logger.info('Redis connected');
  } catch (err) {
    logger.warn({ err }, 'Redis connection failed — SSE relay will not work');
  }

  // Register routes
  await healthRoutes(app, orchestrator);
  await executeRoutes(app, orchestrator);
  await streamRoutes(app);
  await definitionRoutes(app);
  await backgroundRoutes(app, bgManager);
  await skillsRoutes(app, skillsRegistry);
  await executionRoutes(app, orchestrator);
  await resolveRoutes(app);

  // Start server
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' });
    logger.info({ port: PORT, mcpProxy: MCP_PROXY_URL, apiUrl: API_URL }, 'Agent-Proxy started');
  } catch (err) {
    logger.fatal({ err }, 'Failed to start openagentic-proxy');
    process.exit(1);
  }

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down openagentic-proxy...');
    await app.close();
    await closeRedis();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  logger.fatal({ err }, 'Agent-proxy startup failed');
  process.exit(1);
});
