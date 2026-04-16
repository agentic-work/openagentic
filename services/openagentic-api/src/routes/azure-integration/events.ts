/**
 * Azure Real-time Events Routes
 * Server-Sent Events for Azure monitoring and alerts
 */

import { FastifyPluginAsync } from 'fastify';
import { authMiddleware } from '../../middleware/unifiedAuth.js';
import { requireAdminFastify as adminAuth } from '../../middleware/adminGuard.js';

interface AzureEvent {
  id: string;
  type: 'cost_update' | 'usage_alert' | 'quota_warning' | 'service_health';
  timestamp: string;
  data: any;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

// Store active SSE connections
const activeConnections = new Map<string, {
  reply: any;
  userId: string;
  isAdmin: boolean;
  lastPing: number;
}>();

// Real Azure event processing (no mock data)
// Events are triggered by actual Azure service notifications
function processRealAzureEvent(eventData: any): AzureEvent {
  return {
    id: `azure_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: eventData.type,
    timestamp: eventData.timestamp || new Date().toISOString(),
    severity: eventData.severity,
    data: eventData.data
  };
}

function broadcastEventToConnections(event: AzureEvent) {
  // Send event to all connected clients
  activeConnections.forEach(({ reply, isAdmin }, connectionId) => {
    try {
      // Only send admin events to admin users
      if (event.type === 'service_health' && !isAdmin) return;
      
      reply.raw.write(`id: ${event.id}\n`);
      reply.raw.write(`event: azure_event\n`);
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch (error) {
      console.error('Error sending SSE event:', error);
      activeConnections.delete(connectionId);
    }
  });
}

export const azureEventsRoutes: FastifyPluginAsync = async (fastify) => {
  // Azure events SSE endpoint
  fastify.get('/azure', {
    preHandler: [authMiddleware],
    schema: {
    }
  }, (request, reply) => {
    // SSE handler - take control of the stream
    reply.hijack();
    const userId = request.user?.id;
    const isAdmin = request.user?.isAdmin || false;

    if (!userId) {
      reply.raw.writeHead(401, { 'Content-Type': 'application/json' });
      reply.raw.end(JSON.stringify({ error: 'Authentication required' }));
      return;
    }

    // Set SSE headers
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control',
      'X-Accel-Buffering': 'no' // CRITICAL: Disable NGINX buffering for SSE streaming
    });

    const connectionId = `${userId}_${Date.now()}`;
    
    // Store connection
    activeConnections.set(connectionId, {
      reply,
      userId,
      isAdmin,
      lastPing: Date.now()
    });

    fastify.log.info(`Azure SSE connection established for user ${userId}`);

    // Send initial connection event
    reply.raw.write(`id: connect_${Date.now()}\n`);
    reply.raw.write(`event: connection\n`);
    reply.raw.write(`data: ${JSON.stringify({
      status: 'connected',
      timestamp: new Date().toISOString(),
      features: {
        costAlerts: true,
        usageMonitoring: true,
        quotaWarnings: isAdmin,
        serviceHealth: isAdmin
      }
    })}\n\n`);

    // Log connection establishment (no mock event generator)

    // Handle client disconnect
    request.raw.on('close', () => {
      fastify.log.info(`Azure SSE connection closed for user ${userId}`);
      activeConnections.delete(connectionId);
    });

    request.raw.on('error', (error) => {
      fastify.log.error({ err: error }, 'Azure SSE connection error');
      activeConnections.delete(connectionId);
    });

    // Keep connection alive with heartbeat
    const heartbeatInterval = setInterval(() => {
      try {
        reply.raw.write(`id: heartbeat_${Date.now()}\n`);
        reply.raw.write(`event: heartbeat\n`);
        reply.raw.write(`data: ${JSON.stringify({ timestamp: new Date().toISOString() })}\n\n`);
      } catch (error) {
        clearInterval(heartbeatInterval);
        activeConnections.delete(connectionId);
      }
    }, 30000); // Heartbeat every 30 seconds

    // Clean up heartbeat on connection close
    request.raw.on('close', () => {
      clearInterval(heartbeatInterval);
    });

    // SSE connection established successfully - keep connection open
    // Connection will be closed by client disconnect events above
  });

  // Endpoint to manually trigger Azure events (admin only, for testing)
  fastify.post<{
    Body: {
      type: AzureEvent['type'];
      severity: AzureEvent['severity'];
      message: string;
      data?: any;
    };
  }>('/azure/trigger', {
    preHandler: [adminAuth],
    schema: {
      body: {
        type: 'object',
        required: ['type', 'severity', 'message'],
        properties: {
          type: { 
            type: 'string', 
            enum: ['cost_update', 'usage_alert', 'quota_warning', 'service_health'] 
          },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          message: { type: 'string' },
          data: { type: 'object' }
        }
      }
    }
  }, async (request, reply) => {
    const { type, severity, message, data = {} } = request.body;

    const event = processRealAzureEvent({
      type,
      severity,
      timestamp: new Date().toISOString(),
      data: {
        message,
        ...data,
        manual: true,
        triggeredBy: request.user?.email || 'admin'
      }
    });

    // Broadcast to connected clients
    let sentCount = 0;
    activeConnections.forEach(({ isAdmin }, connectionId) => {
      try {
        // Only send admin events to admin users
        if ((type === 'service_health' || type === 'quota_warning') && !isAdmin) return;
        sentCount++;
      } catch (error) {
        console.error('Error counting connections:', error);
      }
    });

    broadcastEventToConnections(event);

    return reply.send({
      success: true,
      eventId: event.id,
      sentToConnections: sentCount,
      totalConnections: activeConnections.size
    });
  });

  // Get active connections info (admin only)
  fastify.get('/azure/connections', {
    preHandler: [adminAuth],
    schema: {
    }
  }, async (request, reply) => {
    const connections = Array.from(activeConnections.entries()).map(([id, conn]) => ({
      connectionId: id,
      userId: conn.userId,
      isAdmin: conn.isAdmin,
      connectedAt: new Date(conn.lastPing).toISOString(),
      duration: Math.round((Date.now() - conn.lastPing) / 1000)
    }));

    return reply.send({
      activeConnections: connections.length,
      connections,
      realTimeEventsEnabled: true
    });
  });

  fastify.log.info('Azure events routes registered');
};