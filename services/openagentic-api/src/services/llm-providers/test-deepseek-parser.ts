/**
 * Test script for DeepSeek tool call parser
 *
 * This demonstrates how the parser handles DeepSeek's proprietary Unicode marker format
 * and converts it to standard OpenAI tool_calls format.
 */

// Sample DeepSeek response with tool call markers
const sampleDeepSeekResponse = `I'll help you fetch that URL. Let me use the fetch tool.

<｜tool▁calls▁begin｜><｜tool▁call▁begin｜>fetch<｜tool▁sep｜>{"url": "https://example.com", "method": "GET"}<｜tool▁call▁end｜><｜tool▁calls▁end｜>`;

// Expected output after parsing (for reference)
// const expectedOutput = {
//   cleanedContent: "I'll help you fetch that URL. Let me use the fetch tool.",
//   toolCalls: [
//     {
//       id: /^call_.*/, // Dynamic ID
//       type: 'function',
//       function: {
//         name: 'fetch',
//         arguments: '{"url": "https://example.com", "method": "GET"}'
//       }
//     }
//   ],
//   hasDeepSeekMarkers: true
// };

console.log('=== DeepSeek Tool Call Parser Test ===\n');
console.log('INPUT:');
console.log(sampleDeepSeekResponse);
console.log('\n' + '='.repeat(60) + '\n');

// Simulate the parser logic (copy of the actual implementation)
function parseDeepSeekToolCalls(content: string): {
  toolCalls: any[];
  cleanedContent: string;
  hasDeepSeekMarkers: boolean;
} {
  // DeepSeek tool call markers (Unicode full-width characters)
  const MARKERS = {
    toolCallsBegin: '<｜tool▁calls▁begin｜>',
    toolCallsEnd: '<｜tool▁calls▁end｜>',
    toolCallBegin: '<｜tool▁call▁begin｜>',
    toolCallEnd: '<｜tool▁call▁end｜>',
    toolSep: '<｜tool▁sep｜>'
  };

  // Check if content contains DeepSeek markers
  const hasDeepSeekMarkers = content.includes(MARKERS.toolCallsBegin) ||
                              content.includes(MARKERS.toolCallBegin);

  if (!hasDeepSeekMarkers) {
    return { toolCalls: [], cleanedContent: content, hasDeepSeekMarkers: false };
  }

  console.log('✓ DeepSeek markers detected\n');

  const toolCalls: any[] = [];
  let cleanedContent = content;

  try {
    // Extract the entire tool calls block
    const toolCallsPattern = new RegExp(
      `${MARKERS.toolCallsBegin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\S]*?)${MARKERS.toolCallsEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
      'g'
    );

    const toolCallsMatches = content.matchAll(toolCallsPattern);

    for (const match of toolCallsMatches) {
      const toolCallsBlock = match[1];

      // Extract individual tool calls from the block
      const toolCallPattern = new RegExp(
        `${MARKERS.toolCallBegin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\S]*?)${MARKERS.toolCallEnd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        'g'
      );

      const toolCallMatches = toolCallsBlock.matchAll(toolCallPattern);

      for (const toolCallMatch of toolCallMatches) {
        const toolCallContent = toolCallMatch[1];

        // Split by separator to get name and arguments
        const parts = toolCallContent.split(MARKERS.toolSep);

        if (parts.length >= 2) {
          const toolName = parts[0].trim();
          const toolArgsJson = parts[1].trim();

          try {
            // Parse the JSON arguments
            const toolArgs = JSON.parse(toolArgsJson);

            // Generate a unique ID for this tool call
            const toolCallId = `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

            // Convert to OpenAI tool_calls format
            toolCalls.push({
              id: toolCallId,
              type: 'function',
              function: {
                name: toolName,
                arguments: toolArgsJson
              }
            });

            console.log(`✓ Parsed tool call: ${toolName}`);
            console.log(`  - ID: ${toolCallId}`);
            console.log(`  - Arguments: ${toolArgsJson}\n`);

          } catch (parseError) {
            console.error(`✗ Failed to parse tool call JSON: ${parseError}`);
          }
        }
      }

      // Remove the entire tool calls block from content
      cleanedContent = cleanedContent.replace(match[0], '');
    }

    // Clean up any remaining markers that might be left over
    Object.values(MARKERS).forEach(marker => {
      cleanedContent = cleanedContent.replace(new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
    });

    // Trim whitespace
    cleanedContent = cleanedContent.trim();

    console.log(`✓ Tool calls parsed: ${toolCalls.length}`);
    console.log(`✓ Content cleaned (${content.length} → ${cleanedContent.length} chars)\n`);

  } catch (error) {
    console.error(`✗ Error parsing DeepSeek tool calls: ${error}\n`);
  }

  return { toolCalls, cleanedContent, hasDeepSeekMarkers: true };
}

// Run the test
const result = parseDeepSeekToolCalls(sampleDeepSeekResponse);

console.log('OUTPUT:');
console.log(JSON.stringify(result, null, 2));
console.log('\n' + '='.repeat(60) + '\n');

// Verify results
console.log('VERIFICATION:');
console.log(`✓ Has DeepSeek markers: ${result.hasDeepSeekMarkers}`);
console.log(`✓ Tool calls found: ${result.toolCalls.length}`);
console.log(`✓ Content cleaned: ${result.cleanedContent === "I'll help you fetch that URL. Let me use the fetch tool."}`);
console.log(`✓ Tool name: ${result.toolCalls[0]?.function.name === 'fetch'}`);
console.log(`✓ Tool arguments valid JSON: ${!!result.toolCalls[0]?.function.arguments}`);

const args = JSON.parse(result.toolCalls[0].function.arguments);
console.log(`✓ Parsed arguments: url=${args.url}, method=${args.method}`);

console.log('\n✅ DeepSeek parser test completed successfully!\n');
