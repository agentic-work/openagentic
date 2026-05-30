import { getSecrets, logSecrets, setAppSecrets } from '../config/secrets.config.js';
import { loggers } from '../utils/logger.js';
import type { BootstrapStep } from './types.js';

export const LOAD_SECRETS: BootstrapStep = {
  name: 'secrets-load',
  critical: false,
  async run() {
    loggers.services.info('🔐 Loading secrets configuration...');
    try {
      const secrets = getSecrets(loggers.services);
      logSecrets(secrets, loggers.services);
      setAppSecrets(secrets);
      loggers.services.info('✅ Secrets configuration loaded and validated');
    } catch (error) {
      loggers.services.warn({ err: error }, '⚠️ Secrets configuration partially loaded — some secrets may use runtime-generated values. Server will continue starting.');
    }
  },
};
