/**
 * File & Attachment Services Routes
 * 
 * Registers file upload, processing, and management endpoints.
 * Provides centralized access to all file-related operations.
 * 
 * @see {@link https://docs.openagentic.io/api/file-attachment}
 */

import { FastifyPluginAsync } from 'fastify';
import { fileUploadRoutes } from './uploads.js';

export const fileAttachmentPlugin: FastifyPluginAsync = async (fastify) => {
  // Register file upload and processing routes
  await fastify.register(fileUploadRoutes, { prefix: '/' });
  
  fastify.log.info('File & Attachment Services routes registered');
};