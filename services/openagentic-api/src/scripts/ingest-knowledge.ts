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
 * Knowledge Ingestion Script
 * 
 * Run this script to populate Milvus with:
 * 1. All project documentation
 * 2. Recent chat conversations
 * 3. Code documentation
 * 
 * Usage:
 *   npm run ingest:knowledge
 *   npm run ingest:knowledge -- --docs-only
 *   npm run ingest:knowledge -- --chats-only
 *   npm run ingest:knowledge -- --last-30-days
 */

import { MilvusClient } from '@zilliz/milvus2-sdk-node';
import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { KnowledgeIngestionService } from '../services/KnowledgeIngestionService.js';
import { config } from 'dotenv';

// Load environment variables
config();

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname'
    }
  }
});

async function main() {
  const args = process.argv.slice(2);
  const docsOnly = args.includes('--docs-only');
  const chatsOnly = args.includes('--chats-only');
  const last30Days = args.includes('--last-30-days');
  const lastNDays = args.find(arg => arg.startsWith('--last-'))?.replace('--last-', '').replace('-days', '');
  
  logger.info('🚀 Starting knowledge ingestion...');
  
  // Initialize connections
  const milvus = new MilvusClient({
    address: process.env.MILVUS_HOST || 'localhost:19530',
    username: process.env.MILVUS_USERNAME,
    password: process.env.MILVUS_PASSWORD
  });
  
  const prisma = new PrismaClient();
  
  // Create ingestion service
  const ingestionService = new KnowledgeIngestionService(milvus, logger, prisma);
  
  try {
    // Initialize collections
    logger.info('📦 Initializing Milvus collections...');
    await ingestionService.initializeCollections();
    
    // Ingest documentation
    if (!chatsOnly) {
      logger.info('📚 Ingesting project documentation...');
      await ingestionService.ingestDocumentation();
    }
    
    // Ingest chat logs
    if (!docsOnly) {
      logger.info('💬 Ingesting chat conversations...');
      
      const options: any = {};
      
      if (last30Days || lastNDays) {
        const days = lastNDays ? parseInt(lastNDays) : 30;
        options.startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        logger.info(`📅 Ingesting chats from last ${days} days`);
      }
      
      await ingestionService.ingestChatLogs(options);
    }
    
    // Display statistics
    const stats = ingestionService.getStats();
    logger.info('✅ Ingestion complete!');
    logger.info('📊 Statistics:');
    logger.info(`  Total documents: ${stats.totalDocuments}`);
    logger.info(`  Total chunks: ${stats.totalChunks}`);
    logger.info(`  Successful: ${stats.successfulChunks}`);
    logger.info(`  Failed: ${stats.failedChunks}`);
    logger.info('  By collection:');
    logger.info(`    Documentation: ${stats.collections.documentation}`);
    logger.info(`    Chats: ${stats.collections.chats}`);
    logger.info(`    Code: ${stats.collections.code}`);
    
    // Test search
    if (!args.includes('--no-test')) {
      logger.info('\n🔍 Testing search functionality...');
      
      const testQueries = [
        'How does authentication work?',
        'What is the MCP architecture?',
        'How to deploy to production?',
        'Database schema',
        'Error handling'
      ];
      
      for (const query of testQueries) {
        logger.info(`\nSearching for: "${query}"`);
        const results = await ingestionService.searchKnowledge(query, { limit: 3 });
        
        for (const result of results) {
          const metadata = JSON.parse(result.metadata || '{}');
          logger.info(`  📄 ${metadata.title || metadata.source} (score: ${result.score?.toFixed(3)})`);
          logger.info(`     ${result.content.substring(0, 100)}...`);
        }
      }
    }
    
  } catch (error) {
    logger.error({ error }, '❌ Ingestion failed');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
    logger.info('👋 Done!');
  }
}

// Run the script
main().catch(error => {
  logger.error({ error }, 'Fatal error');
  process.exit(1);
});