/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * File & Attachment Services Routes
 * 
 * Registers file upload, processing, and management endpoints.
 * Provides centralized access to all file-related operations.
 * 
 * @see {@link https://docs.openagentics.io/api/file-attachment}
 */

import { FastifyPluginAsync } from 'fastify';
import { fileUploadRoutes } from './uploads.js';

export const fileAttachmentPlugin: FastifyPluginAsync = async (fastify) => {
  // Register file upload and processing routes
  await fastify.register(fileUploadRoutes, { prefix: '/' });
  
  fastify.log.info('File & Attachment Services routes registered');
};