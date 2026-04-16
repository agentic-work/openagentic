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