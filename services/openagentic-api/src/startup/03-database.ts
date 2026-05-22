import { loggers } from '../utils/logger.js';
import type { BootstrapStep } from './types.js';

export const INIT_DATABASE: BootstrapStep = {
  name: 'database-init',
  critical: true,
  async run() {
    loggers.database.info('🔄 Initializing database schema and structure...');
    const { DatabaseService } = await import('../services/DatabaseService.js');
    await DatabaseService.initialize();
    loggers.database.info('✅ Database schema initialization completed successfully');
  },
};
