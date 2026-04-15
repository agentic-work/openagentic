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
 * Formats agent messages for better readability using structured markdown
 */
export const formatAgentMessage = (content: string): string => {
  // If already well-formatted, return as-is
  if (content.includes('##') || content.includes('**') || content.includes('###')) {
    return content;
  }

  // Common patterns to enhance
  const enhancedContent = content
    // Convert "Key Point:" or "Important:" to bold
    .replace(/^(Key Point|Important|Note|Summary|Result|Answer|Solution|Explanation):\s*/gim, '**$1:**\n\n')
    
    // Convert numbered lists to proper format
    .replace(/^(\d+)\.\s+/gm, '\n$1. ')
    
    // Convert dash lists to bullet points
    .replace(/^[-–]\s+/gm, '* ')
    
    // Add headers for common sections
    .replace(/^(Overview|Background|Details|Steps|Instructions|Conclusion|Recommendations?):\s*$/gim, '\n## $1\n\n')
    
    // Format code-like content (basic detection)
    .replace(/`([^`]+)`/g, '`$1`')
    
    // Add spacing between paragraphs
    .replace(/\n(?=[A-Z])/g, '\n\n')
    
    // Ensure lists have proper spacing
    .replace(/(\n\*[^\n]+)(\n\*)/g, '$1\n$2');

  return enhancedContent;
};

/**
 * System prompt to encourage structured formatting
 */
export const STRUCTURED_FORMAT_PROMPT = `
When responding, use clear structured markdown formatting:

1. Use headers (##) for main sections
2. Use bold (**text**) for emphasis and key points
3. Use bullet points (*) for lists
4. Use numbered lists (1.) for sequential steps
5. Use code blocks (\`\`\`) for code with language specification
6. Add whitespace between sections for readability
7. Start with a brief summary when answering complex questions

Example structure:
## Summary
**Brief answer to the question**

## Details
* First key point
  * Supporting detail
  * Another detail
* Second key point

## Code Example (if applicable)
\`\`\`language
code here
\`\`\`

## Additional Notes
Any extra context or recommendations.
`;

/**
 * Enhances message with visual indicators
 */
export const addVisualEnhancements = (content: string): string => {
  return content
    // Add icons to common headers
    .replace(/^##\s*Summary/gim, '## 📋 Summary')
    .replace(/^##\s*Overview/gim, '## 🔍 Overview')
    .replace(/^##\s*Details?/gim, '## 📝 Details')
    .replace(/^##\s*Code/gim, '## 💻 Code')
    .replace(/^##\s*Example/gim, '## 📌 Example')
    .replace(/^##\s*Steps?/gim, '## 📋 Steps')
    .replace(/^##\s*Instructions?/gim, '## 📖 Instructions')
    .replace(/^##\s*Warning/gim, '## ⚠️ Warning')
    .replace(/^##\s*Error/gim, '## ❌ Error')
    .replace(/^##\s*Success/gim, '## ✅ Success')
    .replace(/^##\s*Notes?/gim, '## 📝 Notes')
    .replace(/^##\s*Important/gim, '## ❗ Important')
    .replace(/^##\s*Recommendations?/gim, '## 💡 Recommendations');
};
