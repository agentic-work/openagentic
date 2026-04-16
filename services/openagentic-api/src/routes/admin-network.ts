/**
 * Admin Network Security Routes
 *
 * Provides K8s NetworkPolicy management for the admin console.
 *
 * Endpoints:
 * - GET    /api/admin/network/status      — overview of all service policies
 * - GET    /api/admin/network/policies     — list all active NetworkPolicies
 * - GET    /api/admin/network/policies/:name — get specific policy
 * - PUT    /api/admin/network/policies/:service/toggle — enable/disable
 * - POST   /api/admin/network/validate    — dry-run validate a policy
 * - GET    /api/admin/network/services    — list services with ports
 * - GET    /api/admin/network/protected   — get protected connections
 */

import { FastifyInstance, FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify';
import { loggers } from '../utils/logger.js';
import { k8sNetworkPolicyService } from '../services/K8sNetworkPolicyService.js';

const logger = loggers.routes;

export const adminNetworkRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {

  /**
   * GET /status — overview of all service policies
   */
  fastify.get('/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const available = await k8sNetworkPolicyService.isAvailable();
      if (!available) {
        return reply.send({
          available: false,
          error: k8sNetworkPolicyService.getError() || 'K8s client not available (not running in cluster)',
          services: []
        });
      }

      const services = await k8sNetworkPolicyService.getServicePolicyStatus();
      const enabledCount = services.filter(s => s.policyEnabled).length;

      return reply.send({
        available: true,
        services,
        summary: {
          totalServices: services.length,
          policiesEnabled: enabledCount,
          policiesDisabled: services.length - enabledCount,
          criticalServices: services.filter(s => s.critical).length
        }
      });
    } catch (error: any) {
      logger.error({ error }, '[Network] Failed to get status');
      return reply.code(500).send({ error: 'Failed to get network status', message: error.message });
    }
  });

  /**
   * GET /policies — list all active NetworkPolicies
   */
  fastify.get('/policies', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const policies = await k8sNetworkPolicyService.listNetworkPolicies();
      return reply.send({ policies, total: policies.length });
    } catch (error: any) {
      logger.error({ error }, '[Network] Failed to list policies');
      return reply.code(500).send({ error: 'Failed to list network policies', message: error.message });
    }
  });

  /**
   * GET /policies/:name — get specific policy
   */
  fastify.get<{ Params: { name: string } }>('/policies/:name', async (request, reply) => {
    try {
      const policy = await k8sNetworkPolicyService.getNetworkPolicy(request.params.name);
      if (!policy) {
        return reply.code(404).send({ error: 'Policy not found' });
      }
      return reply.send({ policy });
    } catch (error: any) {
      logger.error({ error }, '[Network] Failed to get policy');
      return reply.code(500).send({ error: 'Failed to get network policy', message: error.message });
    }
  });

  /**
   * PUT /policies/:service/toggle — enable/disable a service's NetworkPolicy
   */
  fastify.put<{ Params: { service: string }; Body: { enabled: boolean } }>(
    '/policies/:service/toggle',
    async (request, reply) => {
      try {
        const { service } = request.params;
        const { enabled } = request.body;

        if (!enabled) {
          // Disable = delete the NetworkPolicy
          const policyName = `openagentic-${service}`;
          const result = await k8sNetworkPolicyService.disableServicePolicy(policyName);
          if (!result.success) {
            return reply.code(400).send({ error: result.error });
          }
          return reply.send({ success: true, action: 'disabled', service });
        }

        // Enable = applying a NetworkPolicy requires the Helm template
        // For now, advise using helm upgrade
        return reply.send({
          success: false,
          message: 'Enabling NetworkPolicies requires a Helm upgrade. Run: helm upgrade openagentic ./helm/openagentic --set <service>.networkPolicy.enabled=true',
          service
        });
      } catch (error: any) {
        logger.error({ error }, '[Network] Failed to toggle policy');
        return reply.code(500).send({ error: 'Failed to toggle policy', message: error.message });
      }
    }
  );

  /**
   * POST /validate — dry-run validate a policy spec
   */
  fastify.post<{ Body: any }>('/validate', async (request, reply) => {
    try {
      const result = k8sNetworkPolicyService.validatePolicyChange(request.body);
      return reply.send(result);
    } catch (error: any) {
      logger.error({ error }, '[Network] Failed to validate policy');
      return reply.code(500).send({ error: 'Failed to validate policy', message: error.message });
    }
  });

  /**
   * GET /services — list services with ports, selectors
   */
  fastify.get('/services', async (_request: FastifyRequest, reply: FastifyReply) => {
    try {
      const services = await k8sNetworkPolicyService.listServices();
      return reply.send({ services, total: services.length });
    } catch (error: any) {
      logger.error({ error }, '[Network] Failed to list services');
      return reply.code(500).send({ error: 'Failed to list services', message: error.message });
    }
  });

  /**
   * GET /protected — get protected (never-block) connections
   */
  fastify.get('/protected', async (_request: FastifyRequest, reply: FastifyReply) => {
    return reply.send({
      connections: k8sNetworkPolicyService.getProtectedConnections()
    });
  });

  logger.info('Admin Network Security routes registered');
};

export default adminNetworkRoutes;
