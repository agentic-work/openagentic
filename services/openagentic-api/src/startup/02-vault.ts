import { loggers } from '../utils/logger.js';
import type { BootstrapStep } from './types.js';

export const INIT_VAULT: BootstrapStep = {
  name: 'vault-init',
  critical: false,
  async run() {
    loggers.services.info('Initializing Vault for secret rotation...');
    try {
      const { VaultInitService, setVaultService } = await import('../services/VaultInitService.js');
      const vaultService = new VaultInitService(loggers.services);
      await vaultService.initialize();
      setVaultService(vaultService);
      loggers.services.info('Vault service initialized for secret rotation');
    } catch (error) {
      loggers.services.warn({ err: error }, 'Vault initialization failed - using static secrets only');
    }
  },
};
