import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context/AppContext.js';

export interface BootstrapDeps {
  server: FastifyInstance;
  ctx: AppContext;
}

export interface BootstrapStep {
  name: string;
  critical: boolean;
  run(deps: BootstrapDeps): Promise<void>;
}
