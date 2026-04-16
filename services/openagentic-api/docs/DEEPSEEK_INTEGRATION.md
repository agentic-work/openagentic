# DeepSeek Integration Guide

## Quick Reference

### Problem
DeepSeek models return tool calls in a proprietary Unicode format that appears as raw text in chat responses.

### Solution
Automatic parsing and conversion to standard OpenAI format in `AzureAIFoundryProvider`.

## Key Integration Points

### 1. Parser Function
**Location:** `src/services/llm-providers/AzureAIFoundryProvider.ts:377-491`

```typescript
private parseDeepSeekToolCalls(content: string): {
  toolCalls: any[];
  cleanedContent: string;
  hasDeepSeekMarkers: boolean;
}
```

**What it does:**
- Detects DeepSeek Unicode markers in content
- Extracts tool name and JSON arguments
- Converts to OpenAI `tool_calls` format
- Removes markers from content

### 2. Streaming Integration
**Location:** `src/services/llm-providers/AzureAIFoundryProvider.ts:886-994`

**Modified method:** `streamCompletion()`

```typescript
// Accumulate content during streaming
let accumulatedContent = '';

// On each chunk
if (chunk.choices?.[0]?.delta?.content) {
  accumulatedContent += chunk.choices[0].delta.content;
}

// When complete (finish_reason present)
if (chunk.choices?.[0]?.finish_reason) {
  const { toolCalls, cleanedContent, hasDeepSeekMarkers } =
    this.parseDeepSeekToolCalls(accumulatedContent);

  // Return corrected chunk with parsed tool calls
}
```

### 3. Non-Streaming Integration
**Location:** `src/services/llm-providers/AzureAIFoundryProvider.ts:999-1056`

**Modified method:** `nonStreamCompletion()`

```typescript
// Check response content for markers
if (data.choices?.[0]?.message?.content) {
  const { toolCalls, cleanedContent, hasDeepSeekMarkers } =
    this.parseDeepSeekToolCalls(data.choices[0].message.content);

  // Update response with cleaned content and parsed tool calls
  if (hasDeepSeekMarkers) {
    data.choices[0].message.content = cleanedContent;
    if (toolCalls.length > 0) {
      data.choices[0].message.tool_calls = toolCalls;
      data.choices[0].finish_reason = 'tool_calls';
    }
  }
}
```

## Configuration Options

### Environment Variables

```bash
# Optional: Exclude specific models from selection
AIF_EXCLUDED_MODELS=deepseek,other-model

# Alternative: Force specific model for tool calling
AIF_PREFER_SPECIFIC_MODEL=true
AIF_FUNCTION_CALLING_MODEL=gpt-5
```

### Programmatic Configuration

```typescript
const provider = new AzureAIFoundryProvider(logger, {
  excludedModels: ['deepseek'],  // Optional exclusion
  preferSpecificModel: true,      // Force specific model for tools
  functionCallingModel: 'gpt-5'   // Which model to use for tools
});
```

## DeepSeek Marker Format

### Markers Used
```
<｜tool▁calls▁begin｜>    - Start of tool calls block
<｜tool▁calls▁end｜>      - End of tool calls block
<｜tool▁call▁begin｜>     - Start of individual tool call
<｜tool▁call▁end｜>       - End of individual tool call
<｜tool▁sep｜>            - Separator between name and args
```

### Example Format
```
<｜tool▁calls▁begin｜>
  <｜tool▁call▁begin｜>
    toolName
    <｜tool▁sep｜>
    {"arg": "value"}
  <｜tool▁call▁end｜>
<｜tool▁calls▁end｜>
```

### Converted Format
```json
{
  "id": "call_1763946353949_x9pumjveb",
  "type": "function",
  "function": {
    "name": "toolName",
    "arguments": "{\"arg\": \"value\"}"
  }
}
```

## Testing

### Run Test Script
```bash
cd services/openagenticchat-api
npx tsx src/services/llm-providers/test-deepseek-parser.ts
```

### Manual Testing
1. Configure Azure AI Foundry with `model-router`
2. Send a chat request with tools defined
3. If DeepSeek is selected, check logs for:
   ```
   [AzureAIFoundryProvider] Detected DeepSeek tool call markers - parsing
   [AzureAIFoundryProvider] Parsed DeepSeek tool call: toolName=...
   ```
4. Verify response content has no Unicode markers
5. Verify tool call is executed correctly

## Logging Indicators

### Successful Parsing
```
[AzureAIFoundryProvider] Detected DeepSeek tool call markers - parsing
[AzureAIFoundryProvider] Parsed DeepSeek tool call: toolName=fetch, toolCallId=call_xxx
[AzureAIFoundryProvider] DeepSeek tool calls parsed successfully: toolCallsFound=1
```

### No Markers (Normal Response)
No special logging - response processed normally.

### Parsing Errors
```
[AzureAIFoundryProvider] Failed to parse DeepSeek tool call JSON: error=...
[AzureAIFoundryProvider] Error parsing DeepSeek tool calls: error=...
```

## Troubleshooting

### Issue: Markers Still Appear in Chat

**Check:**
1. Is `AzureAIFoundryProvider` being used?
2. Are logs showing marker detection?
3. Is response streaming or non-streaming?

**Solution:**
- Review logs for parsing errors
- Verify marker format matches expected pattern
- Check that response contains `finish_reason`

### Issue: Tool Calls Not Executing

**Check:**
1. Are tool calls being parsed? (check logs)
2. Is `finish_reason` being set to `tool_calls`?
3. Are tool call IDs being generated?

**Solution:**
- Verify tool call structure matches OpenAI format
- Check that tool name matches registered tools
- Ensure JSON arguments are valid

### Issue: Content Getting Truncated

**Check:**
1. Is content being accumulated correctly in streaming?
2. Are regex patterns matching full marker blocks?

**Solution:**
- Add debug logging to track content accumulation
- Verify marker patterns are correct
- Check for edge cases in marker format

## Best Practices

1. **Monitor Logs:** Always check logs when DeepSeek is selected
2. **Test Coverage:** Test both streaming and non-streaming modes
3. **Error Handling:** Parser has built-in error handling - check logs for issues
4. **Performance:** Parser only activates when markers detected (minimal overhead)
5. **Fallback:** If parsing fails, original content is preserved

## Related Files

- **Main Implementation:** `src/services/llm-providers/AzureAIFoundryProvider.ts`
- **Test Script:** `src/services/llm-providers/test-deepseek-parser.ts`
- **Documentation:** `DEEPSEEK_TOOL_CALL_FIX.md`
- **Provider Config:** `docs/LLM_PROVIDER_CONFIGURATION.md`

---

**Last Updated:** 2025-11-23
**Status:** Production Ready
