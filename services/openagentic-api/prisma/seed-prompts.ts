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
 * Prompt Templates Seed Script
 *
 * Populates the database with default prompt templates from PromptTemplates.ts
 * This ensures the database is populated with the current hardcoded templates
 * and provides a migration path from code-based to database-backed templates.
 *
 * Usage:
 *   npm run db:seed:prompts
 *   or
 *   tsx prisma/seed-prompts.ts
 */

import { PrismaClient } from '@prisma/client';
import { PROMPT_TEMPLATES } from '../src/services/prompts/PromptTemplates.js';

const prisma = new PrismaClient();

async function seedPromptTemplates() {
  console.log('🌱 Starting prompt template seeding...');

  try {
    // Count existing templates
    const existingCount = await prisma.promptTemplate.count();
    console.log(`📊 Found ${existingCount} existing templates in database`);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const template of PROMPT_TEMPLATES) {
      try {
        // Check if template already exists
        const existing = await prisma.promptTemplate.findUnique({
          where: { name: template.name }
        });

        const templateData = {
          name: template.name,
          category: template.category || 'general',
          content: template.content,
          description: template.description || null,
          tags: template.tags || [],
          intelligence: template.intelligence || {},
          model_preferences: template.modelPreferences || {},
          is_default: template.isDefault || false,
          is_active: template.isActive !== undefined ? template.isActive : true
        };

        if (existing) {
          // Update existing template
          await prisma.promptTemplate.update({
            where: { id: existing.id },
            data: {
              ...templateData,
              updated_at: new Date()
            }
          });
          updated++;
          console.log(`✅ Updated: ${template.name}`);
        } else {
          // Create new template
          await prisma.promptTemplate.create({
            data: templateData
          });
          created++;
          console.log(`✨ Created: ${template.name}`);
        }
      } catch (error: any) {
        console.error(`❌ Error processing template "${template.name}":`, error.message);
        skipped++;
      }
    }

    // Ensure only one default template exists
    const defaultTemplates = await prisma.promptTemplate.findMany({
      where: { is_default: true }
    });

    if (defaultTemplates.length > 1) {
      console.log(`⚠️  Found ${defaultTemplates.length} default templates, fixing...`);

      // Keep the first one, unset others
      for (let i = 1; i < defaultTemplates.length; i++) {
        await prisma.promptTemplate.update({
          where: { id: defaultTemplates[i].id },
          data: { is_default: false }
        });
      }

      console.log(`✅ Fixed default templates - kept "${defaultTemplates[0].name}" as default`);
    } else if (defaultTemplates.length === 0) {
      // No default template, set the first active one as default
      const firstActive = await prisma.promptTemplate.findFirst({
        where: { is_active: true },
        orderBy: { created_at: 'asc' }
      });

      if (firstActive) {
        await prisma.promptTemplate.update({
          where: { id: firstActive.id },
          data: { is_default: true }
        });
        console.log(`✅ Set "${firstActive.name}" as default template`);
      }
    }

    // Summary
    const finalCount = await prisma.promptTemplate.count();
    console.log('\n📈 Seeding Summary:');
    console.log(`   Created: ${created}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Total templates in DB: ${finalCount}`);
    console.log('\n✅ Prompt template seeding completed successfully!');

  } catch (error: any) {
    console.error('❌ Fatal error during seeding:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seed function
seedPromptTemplates()
  .catch((error) => {
    console.error('❌ Seeding failed:', error);
    process.exit(1);
  });
