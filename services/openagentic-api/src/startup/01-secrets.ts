import { getSecrets, logSecrets, setAppSecrets } from '../config/secrets.config.js';
import { loggers } from '../utils/logger.js';
import type { BootstrapStep } from './types.js';

export const LOAD_SECRETS: BootstrapStep = {
  name: 'secrets-load',
  // B2 (NIST IA-5/CM-6/SI-10): in production, a missing/weak secret is FATAL —
  // loadSecrets() throws and we must NOT swallow it (fail closed). In
  // development the loader returns ephemeral generated values and never throws.
  critical: true,
  async run() {
    loggers.services.info('🔐 Loading secrets configuration...');
    const isProduction = process.env.NODE_ENV === 'production';
    try {
      const secrets = getSecrets(loggers.services);
      logSecrets(secrets, loggers.services);
      setAppSecrets(secrets);
      loggers.services.info('✅ Secrets configuration loaded and validated');
    } catch (error) {
      if (isProduction) {
        // Fail closed: re-raise so the critical bootstrap step aborts boot.
        loggers.services.error({ err: error }, '❌ FATAL: secrets validation failed in production — refusing to start.');
        throw error;
      }
      loggers.services.warn({ err: error }, '⚠️ Secrets configuration partially loaded (non-production) — some secrets may use runtime-generated values. Server will continue starting.');
    }
  },
};
