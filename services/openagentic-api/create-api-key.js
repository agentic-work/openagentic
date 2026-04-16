#!/usr/bin/env node
/**
 * Create a test API key for workflows testing
 */

const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://openagentic:openagentic123@localhost:5432/openagentic'
    }
  }
});

async function main() {
  const userEmail = 'phatoldsun@gmail.com';

  try {
    // Find user
    const user = await prisma.user.findFirst({
      where: { email: userEmail }
    });

    if (!user) {
      console.error(`User not found: ${userEmail}`);
      process.exit(1);
    }

    console.log(`Found user: ${user.id} (${user.email})`);

    // Generate API key
    const randomBytes = crypto.randomBytes(32).toString('hex');
    const apiKey = `awc_${randomBytes}`;

    // Hash for storage
    const keyHash = await bcrypt.hash(apiKey, 10);

    // Create API key record
    const apiKeyRecord = await prisma.apiKey.create({
      data: {
        user_id: user.id,
        name: `Workflow Test Key ${new Date().toISOString()}`,
        key_hash: keyHash,
        expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
        is_active: true
      }
    });

    console.log('\n✅ API Key created successfully!');
    console.log(`\nAPI Key ID: ${apiKeyRecord.id}`);
    console.log(`Name: ${apiKeyRecord.name}`);
    console.log(`\nAPI Key (save this - shown only once):\n${apiKey}\n`);
    console.log(`\nTest with:\ncurl -H "Authorization: Bearer ${apiKey}" http://localhost:3000/api/workflows\n`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
