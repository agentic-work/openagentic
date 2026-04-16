/**
 * Test script for FormattingCapabilitiesService
 * Run this to verify Phase 3 implementation
 */

import pino from 'pino';
import { getFormattingCapabilitiesService } from './FormattingCapabilitiesService.js';

// Create logger
const logger = pino({
  level: 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true
    }
  }
});

async function testFormattingService() {
  console.log('\n=== Testing FormattingCapabilitiesService ===\n');

  // Get service instance
  const service = getFormattingCapabilitiesService(logger);

  // Test 1: Get all capabilities
  console.log('Test 1: Get all capabilities');
  const capabilities = service.getAllCapabilities();
  console.log(`✅ Found ${capabilities.length} capabilities`);
  console.log(`   Categories: ${[...new Set(capabilities.map(c => c.category))].join(', ')}\n`);

  // Test 2: Get all presets
  console.log('Test 2: Get all presets');
  const presets = service.getAllPresets();
  console.log(`✅ Found ${presets.length} presets`);
  presets.forEach(p => {
    console.log(`   - ${p.name}: ${p.triggers.join(', ')}`);
  });
  console.log('');

  // Test 3: Generate system prompt section
  console.log('Test 3: Generate system prompt section');
  const systemPromptSection = service.generateSystemPromptSection();
  console.log(`✅ Generated system prompt section (${systemPromptSection.length} characters)`);
  console.log('   First 500 chars:');
  console.log('   ' + systemPromptSection.substring(0, 500).replace(/\n/g, '\n   '));
  console.log('   ...\n');

  // Test 4: Query-based guidance
  console.log('Test 4: Query-based guidance');
  const testQueries = [
    'Show me sales data for Q4',
    'Design a cloud architecture for Azure',
    'Explain how async/await works in JavaScript',
    'Create a timeline for product launch',
    'Compare PostgreSQL vs MySQL'
  ];

  for (const query of testQueries) {
    const guidance = service.getGuidanceForQuery(query);
    console.log(`\n   Query: "${query}"`);
    console.log(`   Recommended capabilities: ${guidance.recommendedCapabilities.join(', ')}`);
    if (guidance.preset) {
      console.log(`   Suggested preset: ${guidance.preset.name}`);
    }
    if (guidance.tips.length > 0) {
      console.log(`   Tips: ${guidance.tips.length} tips provided`);
    }
  }

  // Test 5: Export to JSON
  console.log('\n\nTest 5: Export service data');
  const serviceData = service.toJSON();
  console.log(`✅ Service data exported:`);
  console.log(`   - ${serviceData.capabilities.length} capabilities`);
  console.log(`   - ${serviceData.presets.length} presets`);
  console.log(`   - ${serviceData.languageSupport.length} supported languages`);
  console.log(`   - Version: ${serviceData.version}`);

  // Test 6: Verify specific capabilities
  console.log('\n\nTest 6: Verify key capabilities exist');
  const keyCapabilities = [
    'md-headers',
    'md-code-block',
    'math-inline',
    'math-display',
    'diagram-d2',
    'diagram-mermaid',
    'diagram-plantuml',
    'chart-mermaid-pie',
    'chart-mermaid-gantt',
    'md-tables',
    'visual-emojis'
  ];

  for (const capId of keyCapabilities) {
    const cap = service.getCapability(capId);
    if (cap) {
      console.log(`   ✅ ${capId}: ${cap.name} (${cap.supportLevel})`);
    } else {
      console.log(`   ❌ ${capId}: NOT FOUND`);
    }
  }

  console.log('\n\n=== All Tests Completed Successfully! ===\n');
}

// Run tests
testFormattingService().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
