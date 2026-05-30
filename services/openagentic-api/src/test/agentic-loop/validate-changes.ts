#!/usr/bin/env npx tsx
/**
 * Validate Changes - Quick validation script for A2A loop
 *
 * This script is called by Claude Code to have hal/gpt-oss validate changes.
 * It reads the specified files from the shared synology mount and asks gpt-oss
 * to analyze them for issues.
 *
 * Usage:
 *   npx tsx src/test/agentic-loop/validate-changes.ts <file1> [file2] [file3] ...
 *   npx tsx src/test/agentic-loop/validate-changes.ts --build  # Validate build output
 *   npx tsx src/test/agentic-loop/validate-changes.ts --recent # Validate recently modified files
 */

import { readFileSync, statSync, readdirSync } from 'fs';
import { join, relative } from 'path';

const OLLAMA_URL = process.env.HAL_OLLAMA_URL || 'http://gpu-node:11434';
const MODEL = process.env.HAL_OLLAMA_MODEL || 'gpt-oss';
const CODEBASE_ROOT = '/mnt/synology/Code/company/openagentic/agentic';

interface ValidationResult {
  status: 'pass' | 'fail' | 'warning';
  summary: string;
  issues: string[];
  suggestions: string[];
  filesAnalyzed: string[];
  duration: number;
}

async function callOllama(prompt: string, systemPrompt: string): Promise<string> {
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      stream: false,
      options: {
        temperature: 0.3,
        num_predict: 2048
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Ollama error: ${response.status}`);
  }

  const data = await response.json();
  return data.message?.content || '';
}

function getRecentlyModifiedFiles(dir: string, minutes: number = 30): string[] {
  const cutoff = Date.now() - (minutes * 60 * 1000);
  const files: string[] = [];

  function scan(directory: string) {
    try {
      const entries = readdirSync(directory, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(directory, entry.name);

        // Skip node_modules, dist, .git
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
          continue;
        }

        if (entry.isDirectory()) {
          scan(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
          const stat = statSync(fullPath);
          if (stat.mtimeMs > cutoff) {
            files.push(fullPath);
          }
        }
      }
    } catch (e) {
      // Skip directories we can't read
    }
  }

  scan(dir);
  return files;
}

async function validateFiles(files: string[]): Promise<ValidationResult> {
  const startTime = Date.now();

  // Read file contents
  const fileContents: { path: string; content: string }[] = [];
  for (const file of files) {
    try {
      const fullPath = file.startsWith('/') ? file : join(CODEBASE_ROOT, file);
      const content = readFileSync(fullPath, 'utf-8');
      const relativePath = relative(CODEBASE_ROOT, fullPath);
      fileContents.push({ path: relativePath, content });
    } catch (e) {
      console.error(`Cannot read file: ${file}`);
    }
  }

  if (fileContents.length === 0) {
    return {
      status: 'fail',
      summary: 'No files to analyze',
      issues: ['No readable files provided'],
      suggestions: [],
      filesAnalyzed: [],
      duration: Date.now() - startTime
    };
  }

  // Build prompt
  let prompt = 'Analyze the following TypeScript files for issues:\n\n';
  for (const { path, content } of fileContents) {
    // Truncate very long files
    const truncated = content.length > 10000 ? content.substring(0, 10000) + '\n... (truncated)' : content;
    prompt += `=== ${path} ===\n${truncated}\n\n`;
  }

  prompt += `
Please analyze these files and respond in this EXACT format:

STATUS: [PASS or FAIL or WARNING]
SUMMARY: [One line summary]
ISSUES:
- [Issue 1]
- [Issue 2]
SUGGESTIONS:
- [Suggestion 1]
- [Suggestion 2]

Focus on:
1. TypeScript errors or type issues
2. Security vulnerabilities
3. Logic errors or bugs
4. Missing error handling
5. Performance issues
`;

  const systemPrompt = `You are a code review agent. You analyze TypeScript code and identify issues.
Be concise and specific. Only report real issues, not style preferences.
If the code looks good, say STATUS: PASS with a brief positive summary.`;

  // Call ollama
  const response = await callOllama(prompt, systemPrompt);

  // Parse response
  const statusMatch = response.match(/STATUS:\s*(PASS|FAIL|WARNING)/i);
  const summaryMatch = response.match(/SUMMARY:\s*(.+?)(?=\n|ISSUES:|$)/is);
  const issuesMatch = response.match(/ISSUES:\s*([\s\S]*?)(?=SUGGESTIONS:|$)/i);
  const suggestionsMatch = response.match(/SUGGESTIONS:\s*([\s\S]*?)$/i);

  const status = statusMatch?.[1]?.toUpperCase() === 'PASS' ? 'pass' :
                 statusMatch?.[1]?.toUpperCase() === 'WARNING' ? 'warning' : 'fail';

  const issues = issuesMatch?.[1]
    ?.split('\n')
    .map(l => l.trim().replace(/^[-*]\s*/, ''))
    .filter(l => l.length > 0 && !l.toLowerCase().includes('none')) || [];

  const suggestions = suggestionsMatch?.[1]
    ?.split('\n')
    .map(l => l.trim().replace(/^[-*]\s*/, ''))
    .filter(l => l.length > 0 && !l.toLowerCase().includes('none')) || [];

  return {
    status: issues.length === 0 ? 'pass' : status,
    summary: summaryMatch?.[1]?.trim() || 'Analysis complete',
    issues,
    suggestions,
    filesAnalyzed: fileContents.map(f => f.path),
    duration: Date.now() - startTime
  };
}

async function validateBuild(): Promise<ValidationResult> {
  const startTime = Date.now();
  const { execSync } = await import('child_process');

  try {
    const output = execSync('npm run build 2>&1', {
      cwd: join(CODEBASE_ROOT, 'services/openagentic-api'),
      encoding: 'utf-8',
      timeout: 120000
    });

    // Check for errors in output
    const hasErrors = output.includes('error TS') || output.includes('Error:');

    if (hasErrors) {
      // Ask gpt-oss to analyze the errors
      const prompt = `Analyze this TypeScript build output and identify the issues:\n\n${output}\n\nProvide a summary of what needs to be fixed.`;
      const analysis = await callOllama(prompt, 'You are a TypeScript expert. Analyze build errors and provide fixes.');

      return {
        status: 'fail',
        summary: 'Build has errors',
        issues: [analysis],
        suggestions: [],
        filesAnalyzed: ['npm run build'],
        duration: Date.now() - startTime
      };
    }

    return {
      status: 'pass',
      summary: 'Build successful - TypeScript compiled without errors',
      issues: [],
      suggestions: [],
      filesAnalyzed: ['npm run build'],
      duration: Date.now() - startTime
    };
  } catch (error: any) {
    return {
      status: 'fail',
      summary: 'Build failed',
      issues: [error.stdout || error.message],
      suggestions: [],
      filesAnalyzed: ['npm run build'],
      duration: Date.now() - startTime
    };
  }
}

function printResult(result: ValidationResult): void {
  const statusIcon = result.status === 'pass' ? '✅' : result.status === 'warning' ? '⚠️' : '❌';

  console.log('\n' + '═'.repeat(80));
  console.log(`${statusIcon} VALIDATION RESULT: ${result.status.toUpperCase()}`);
  console.log('═'.repeat(80));
  console.log(`Summary: ${result.summary}`);
  console.log(`Duration: ${result.duration}ms`);
  console.log(`Files: ${result.filesAnalyzed.join(', ')}`);

  if (result.issues.length > 0) {
    console.log('\n❌ Issues:');
    result.issues.forEach((issue, i) => console.log(`  ${i + 1}. ${issue}`));
  }

  if (result.suggestions.length > 0) {
    console.log('\n💡 Suggestions:');
    result.suggestions.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  }

  console.log('═'.repeat(80) + '\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.log(`
Validate Changes - A2A Loop Validation

Usage:
  npx tsx validate-changes.ts <file1> [file2] ...   Validate specific files
  npx tsx validate-changes.ts --build               Validate build output
  npx tsx validate-changes.ts --recent [minutes]    Validate recently modified files

Environment:
  HAL_OLLAMA_URL   Ollama URL (default: http://gpu-node:11434)
  HAL_OLLAMA_MODEL Model to use (default: gpt-oss)
`);
    return;
  }

  let result: ValidationResult;

  if (args.includes('--build')) {
    console.log('🔨 Validating build...');
    result = await validateBuild();
  } else if (args.includes('--recent')) {
    const minutesArg = args[args.indexOf('--recent') + 1];
    const minutes = minutesArg && !minutesArg.startsWith('-') ? parseInt(minutesArg, 10) : 30;

    console.log(`🔍 Finding files modified in last ${minutes} minutes...`);
    const files = getRecentlyModifiedFiles(join(CODEBASE_ROOT, 'services/openagentic-api/src'), minutes);

    if (files.length === 0) {
      console.log('No recently modified files found.');
      return;
    }

    console.log(`Found ${files.length} files to validate`);
    result = await validateFiles(files);
  } else {
    console.log(`🔍 Validating ${args.length} file(s)...`);
    result = await validateFiles(args);
  }

  printResult(result);

  // Exit with appropriate code
  process.exit(result.status === 'pass' ? 0 : 1);
}

main().catch(err => {
  console.error('Validation failed:', err);
  process.exit(1);
});
