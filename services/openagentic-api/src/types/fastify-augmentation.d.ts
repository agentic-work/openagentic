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
 * Fastify type augmentations
 * This file extends Fastify's built-in types with our custom properties
 */

import '@fastify/jwt';
import { UserPayload } from './index.ts';
import { PrismaClient } from '@prisma/client';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: UserPayload;
    user: UserPayload;
  }
}

// Augment fastify instance with custom properties
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: any;
    verifyJWT: any;
    jwt: any;
    prisma: PrismaClient;
  }
  
  interface FastifyRequest {
    // User is set by auth middleware
    user?: UserPayload;
  }
}

export {};