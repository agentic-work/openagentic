/**
 * Monitoring WebSocket Routes
 * Provides real-time WebSocket monitoring for MCP servers and system metrics
 * Expected by the UI at /api/monitoring/ws
 */

import { FastifyPluginAsync } from 'fastify';
import { authMiddleware } from '../middleware/unifiedAuth.js';
import { loggers } from '../utils/logger.js';
import { prisma } from '../utils/prisma.js';

const logger = loggers.routes;

// WebSocket client tracking
const wsClients = new Map<string, any>();

// MCP monitoring data cache
let latestMCPMetrics: any = null;
let metricsUpdateInterval: NodeJS.Timeout | null = null;

// Helper to fetch MCP server data
async function fetchMCPServerData(userId: string, isAdmin: boolean = false) {
  try {
    // Get server configs from database
    const servers = await prisma.mCPServerConfig.findMany({
      where: {
        enabled: true,
        OR: [
          { user_isolated: false },
          { user_isolated: true, instances: { some: { user_id: userId } } }
        ]
      },
      include: {
        instances: {
          where: { user_id: userId },
          orderBy: { started_at: 'desc' },
          take: 1
        },
        status: true
      }
    });

    // Transform to expected format
    const serversWithMetrics = servers.map((server: any) => ({
      id: server.id,
      name: server.name,
      description: server.description,
      enabled: server.enabled,
      status: {
        state: server.instances?.[0]?.status || 'stopped',
        uptime: server.instances?.[0] ? Date.now() - new Date(server.instances[0].started_at).getTime() : 0,
        memory: Math.floor(Math.random() * 100), // Mock memory usage
        cpu: Math.floor(Math.random() * 50), // Mock CPU usage  
        lastHealthCheck: server.status?.[0]?.last_checked || null
      },
      capabilities: server.capabilities,
      instance: server.instances?.[0] ? {
        id: server.instances[0].instance_id,
        pid: parseInt(server.instances[0].process_id || '0'),
        port: server.instances[0].config?.port || 0,
        startedAt: server.instances[0].started_at
      } : null,
      metrics: {
        totalCalls: Math.floor(Math.random() * 1000), // Mock metrics
        avgLatency: Math.floor(Math.random() * 200) + 50,
        successRate: 0.95 + Math.random() * 0.05,
        errorRate: Math.random() * 0.05
      }
    }));

    return {
      servers: serversWithMetrics,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Failed to fetch MCP server data', { error });
    return {
      servers: [],
      timestamp: new Date().toISOString(),
      error: 'Failed to fetch server data'
    };
  }
}

// Broadcast to all connected clients
function broadcastToAll(data: any) {
  wsClients.forEach((ws, userId) => {
    if (ws.readyState === 1) { // WebSocket.OPEN
      try {
        ws.send(JSON.stringify(data));
      } catch (error) {
        logger.warn(`Failed to send data to user ${userId}`, { error });
        wsClients.delete(userId);
      }
    }
  });
}

// Start periodic metrics updates
function startPeriodicUpdates() {
  if (metricsUpdateInterval) {
    clearInterval(metricsUpdateInterval);
  }

  metricsUpdateInterval = setInterval(async () => {
    if (wsClients.size === 0) {
      return; // No clients connected, skip update
    }

    try {
      // Get metrics for all connected users (simplified for demo)
      const adminUser = Array.from(wsClients.keys())[0]; // Use first user for demo
      const metricsData = await fetchMCPServerData(adminUser, true);
      
      latestMCPMetrics = metricsData;
      
      // Broadcast metrics to all connected clients
      broadcastToAll({
        type: 'metrics',
        data: metricsData,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      logger.error('Failed to update metrics', { error });
    }
  }, 5000); // Update every 5 seconds
}

// Stop periodic updates
function stopPeriodicUpdates() {
  if (metricsUpdateInterval) {
    clearInterval(metricsUpdateInterval);
    metricsUpdateInterval = null;
  }
}

export const monitoringWebSocketRoutes: FastifyPluginAsync = async (fastify) => {
  
  /**
   * WebSocket endpoint for real-time MCP monitoring
   * WS /api/monitoring/ws
   */
  fastify.get('/ws', { 
    websocket: true,
    preHandler: [authMiddleware as any] 
  } as any, (connection: any, req: any) => {
    const ws = connection.socket;
    const userId = req.user?.id || 'anonymous';
    const isAdmin = req.user?.isAdmin || false;
    
    wsClients.set(userId, ws);
    logger.info(`MCP monitoring WebSocket connected for user ${userId}`);
    
    // Send initial connection confirmation
    ws.send(JSON.stringify({
      type: 'connected',
      timestamp: new Date().toISOString(),
      userId,
      message: 'Connected to MCP monitoring'
    }));
    
    // Send latest metrics if available
    if (latestMCPMetrics) {
      ws.send(JSON.stringify({
        type: 'metrics',
        data: latestMCPMetrics,
        timestamp: new Date().toISOString()
      }));
    } else {
      // Fetch initial metrics for this user
      fetchMCPServerData(userId, isAdmin).then(data => {
        latestMCPMetrics = data;
        ws.send(JSON.stringify({
          type: 'metrics',
          data,
          timestamp: new Date().toISOString()
        }));
      }).catch(error => {
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Failed to fetch initial metrics',
          timestamp: new Date().toISOString()
        }));
      });
    }
    
    // Start periodic updates if this is the first client
    if (wsClients.size === 1) {
      startPeriodicUpdates();
    }
    
    // Heartbeat to keep connection alive
    const heartbeat = setInterval(() => {
      if (ws.readyState === 1) { // WebSocket.OPEN
        ws.send(JSON.stringify({ 
          type: 'heartbeat',
          timestamp: new Date().toISOString()
        }));
      }
    }, 30000); // Every 30 seconds
    
    // Handle connection close
    ws.on('close', () => {
      clearInterval(heartbeat);
      wsClients.delete(userId);
      logger.info(`MCP monitoring WebSocket disconnected for user ${userId}`);
      
      // Stop periodic updates if no clients left
      if (wsClients.size === 0) {
        stopPeriodicUpdates();
      }
    });
    
    // Handle incoming messages
    ws.on('message', async (data: any) => {
      try {
        const message = JSON.parse(data.toString());
        await handleWebSocketMessage(message, userId, isAdmin, ws);
      } catch (error) {
        ws.send(JSON.stringify({ 
          type: 'error', 
          error: 'Invalid message format',
          timestamp: new Date().toISOString()
        }));
      }
    });
    
    // Handle errors
    ws.on('error', (error: any) => {
      logger.error(`WebSocket error for user ${userId}`, { error });
    });
  });
  
  // Handle WebSocket messages
  async function handleWebSocketMessage(message: any, userId: string, isAdmin: boolean, ws: any) {
    switch (message.type) {
      case 'subscribe_metrics':
        // Client wants to subscribe to specific server metrics
        ws.send(JSON.stringify({
          type: 'subscribed',
          serverIds: message.serverIds || [],
          timestamp: new Date().toISOString()
        }));
        break;
        
      case 'refresh_metrics':
        // Client requests fresh metrics
        try {
          const freshData = await fetchMCPServerData(userId, isAdmin);
          latestMCPMetrics = freshData;
          ws.send(JSON.stringify({
            type: 'metrics',
            data: freshData,
            timestamp: new Date().toISOString()
          }));
        } catch (error) {
          ws.send(JSON.stringify({
            type: 'error',
            error: 'Failed to refresh metrics',
            timestamp: new Date().toISOString()
          }));
        }
        break;
        
      case 'ping':
        // Respond to ping
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: new Date().toISOString()
        }));
        break;
        
      default:
        ws.send(JSON.stringify({ 
          type: 'error', 
          error: `Unknown message type: ${message.type}`,
          timestamp: new Date().toISOString()
        }));
    }
  }
  
  logger.info('Monitoring WebSocket routes registered at /api/monitoring/ws');
};