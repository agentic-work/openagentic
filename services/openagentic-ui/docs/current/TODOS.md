# Current Development Tasks

**Last Updated:** 2026-01-01
**Status:** In Progress

---

## 1. LLM Provider Configuration Overhaul

### 1.1 Research Phase - COMPLETED
- [x] Research Anthropic SDK options (via Bedrock/Foundry)
- [x] Research OpenAI SDK options (via Azure OpenAI)
- [x] Research Google Vertex AI SDK options (@google/genai SDK)
- [x] Research Azure OpenAI SDK options
- [x] Research Ollama SDK options
- [x] Research AWS Bedrock SDK options

### Research Findings Summary:

**Current Backend Providers (5):**
1. Azure OpenAI - Full SDK support (temperature, top_p, frequency_penalty, presence_penalty, max_tokens, JSON mode, tools)
2. AWS Bedrock - Extended thinking support, Claude tool calling, streaming
3. Google Vertex AI - Gemini 2.5/3 with thinking, function calling, vision, grounding
4. Ollama - Local execution, basic config
5. Azure AI Foundry - Dual API format (Anthropic/OpenAI)

**Current UI (LLMProviderManagement.tsx):**
- 5 tabs: Playground, Providers, Models, Ollama, Metrics
- Basic provider CRUD
- Health monitoring
- Model catalog
- Multi-model orchestration config

**Gaps to Fill:**
- No per-provider SDK configuration tabs
- Playground missing: top_k, stop_sequences, frequency_penalty, safety_settings
- No cost rate configuration UI
- No thinking budget controls in UI
- No tool configuration options

### 1.2 API Implementation - COMPLETED ✅
- [x] Enhanced Playground API with ALL SDK config options
- [x] Added `/api/admin/llm-providers/sdk-options` endpoint for UI consumption
- [x] Added new `thinking` test type for extended thinking testing
- [x] Added comprehensive config: frequencyPenalty, presencePenalty, seed, responseFormat, logprobs
- [x] Added thinkingBudget controls for Claude/Gemini
- [x] Added safetySettings for Google Vertex
- [x] Added Ollama options: numCtx, repeatPenalty, mirostat

### 1.3 Admin UI Implementation - IN PROGRESS
- [x] Enhanced Playground with dynamic provider-specific controls
- [x] Universal options: temperature, maxTokens, topP, topK
- [x] OpenAI options: frequencyPenalty, presencePenalty, responseFormat
- [x] Claude options: Extended Thinking toggle, thinkingBudget
- [x] Google options: safetyLevel, grounding, thinking mode
- [x] Ollama options: context length, repeatPenalty, mirostat
- [ ] Create dedicated provider configuration tabs (for detailed config)
- [ ] Add provider creation wizard with all SDK options

---

## 2. Playground Upgrade - COMPLETED ✅

- [x] Audited current Playground capabilities
- [x] Added temperature slider (0-2, step 0.1)
- [x] Added top_p/top_k controls
- [x] Added max_tokens control (up to 200K)
- [x] Added streaming toggle
- [x] Added thinking/extended thinking toggle (Claude, Gemini)
- [x] Added safety level settings (Google)
- [x] Added frequency/presence penalty (OpenAI)
- [x] Added response format options (text/JSON)
- [x] Added Ollama-specific options (context, mirostat)
- [x] Provider auto-detection for showing relevant options
- [ ] Add model comparison mode (future enhancement)

---

## 3. AI Personality Feature Testing - COMPLETED ✅

- [x] Test API key: `<redacted — must be provided via env>`
- [x] Verify personality selector in ChatInputToolbar
- [x] Test personality application to messages
- [x] Verify system prompt injection - "Ahoy matey!" pirate working
- [x] Tested pirate and shakespeare personalities - both working
- [x] Verified enable/disable toggle works correctly

---

## 4. Code Mode Fix (React Error #185) - IN PROGRESS

### Current Status
- [x] Created Playwright test that reproduces the error
- [x] Applied fix to AuthContext.tsx (useCallback, useMemo)
- [x] Fixed ChatContainer.tsx - Code Mode WebSocket was imported but not used
- [x] Added proper useCodeModeWebSocket hook connection when in code mode
- [x] Passed sendMessage callback to CodeModeLayoutV2 component
- [ ] Rebuild and test: `./scripts/build-fixed-v2.sh --buildpush --registry harbor.agenticwork.io/openagentic --no-cache && docker compose up -d`
- [ ] Verify fix with Playwright test

### Fix Details (2026-01-01)
**Issue**: ChatContainer imported `useCodeModeWebSocket` but never used it. When Code Mode was activated, `CodeModeLayoutV2` was rendered without a WebSocket connection, and the `onSendMessage` prop was not passed. This could cause issues with store state management.

**Solution**:
1. Connected `useCodeModeWebSocket` with `enabled: appMode === 'code' && userPermissions.canUseAwcode`
2. Passed `onSendMessage={sendCodeModeMessage}` to CodeModeLayoutV2

File changed: `src/features/chat/components/ChatContainer.tsx`

### Build Command
```bash
./scripts/build-fixed-v2.sh --buildpush --registry harbor.agenticwork.io/openagentic --no-cache && docker compose up -d
```

### Test Command
```bash
cd /mnt/synology/Code/company/openagentic/agentic/services/openagentic-ui
npx playwright test e2e/code-mode.spec.ts --headed
```

---

## 5. Completed Tasks

- [x] Updated accent colors to ROYGBIV order (ThemeContext.jsx)
- [x] Created custom icon library (src/shared/icons/)
- [x] Migrated 132 files from lucide-react to custom icons
---

## Notes

- Build takes ~5-10 minutes
- Test on localhost:8080 after docker compose up
