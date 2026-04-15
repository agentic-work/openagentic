#!/usr/bin/env node
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
