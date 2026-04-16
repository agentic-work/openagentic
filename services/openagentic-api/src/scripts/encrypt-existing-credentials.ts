#!/usr/bin/env tsx
/**
 * One-time migration: Encrypt existing plaintext auth_config fields in LLMProvider table.
 *
 * Usage:
 *   npx tsx src/scripts/encrypt-existing-credentials.ts
 *
 * This script:
 * 1. Reads all LLMProvider rows
 * 2. For each row, checks if sensitive fields in auth_config are already encrypted (local: prefix)
 * 3. If not, encrypts them in-place using VaultService's local AES-256-CBC encryption
 * 4. Updates the row
 *
 * Safe to run multiple times - already-encrypted fields are skipped.
 * Requires LOCAL_ENCRYPTION_KEY env var to be set (same key as the running API).
 */

// Dynamic imports to handle ESM module resolution at runtime
async function main() {
  const { encryptAuthConfig } = await import('../services/llm-providers/CredentialEncryptionService.js');
  const { PrismaClient } = await import('@prisma/client');

  const prisma = new PrismaClient();

  try {
    const providers = await prisma.lLMProvider.findMany();
    console.log(`Found ${providers.length} LLM providers to check`);

    let encrypted = 0;
    let skipped = 0;

    for (const provider of providers) {
      const authConfig = provider.auth_config as any;
      if (!authConfig || typeof authConfig !== 'object') {
        console.log(`  [SKIP] ${provider.name} - no auth_config`);
        skipped++;
        continue;
      }

      // Check if any sensitive field needs encryption
      const sensitiveFields = ['apiKey', 'key', 'clientSecret', 'secretAccessKey', 'credentials', 'accessKeyId', 'password', 'token'];
      const needsEncryption = sensitiveFields.some(
        field => typeof authConfig[field] === 'string' && authConfig[field].length > 0 && !authConfig[field].startsWith('local:')
      );

      if (!needsEncryption) {
        console.log(`  [SKIP] ${provider.name} - already encrypted or no sensitive fields`);
        skipped++;
        continue;
      }

      const encryptedConfig = encryptAuthConfig(authConfig);

      await prisma.lLMProvider.update({
        where: { id: provider.id },
        data: { auth_config: encryptedConfig }
      });

      console.log(`  [ENCRYPTED] ${provider.name} (${provider.provider_type})`);
      encrypted++;
    }

    console.log(`\nDone: ${encrypted} encrypted, ${skipped} skipped`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
