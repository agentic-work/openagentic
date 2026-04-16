# GitHub Models Prompt Repository

This directory contains standardized AI prompts for GitHub Actions workflows, optimized for our OpenAgenticChat enterprise application.

## 📋 Available Prompts

### 🛡️ Security & Code Review
- **`security-code-review.prompt.yml`** - Comprehensive security analysis using **Claude Opus 4.1**
  - **Model**: `anthropic.claude-opus-4-1-20250805-v1:0` (AWS Bedrock)
  - **Purpose**: Detect vulnerabilities, security risks, and provide detailed remediation
  - **Output**: Structured security reports with severity levels (🔴 CRITICAL, 🟡 WARNING, 🟢 SUGGESTION)

### 🧪 Test Generation
- **`test-generation.prompt.yml`** - Intelligent test suite generation
  - **Model**: `gpt-4o`
  - **Purpose**: Generate unit, integration, and smoke tests for code changes
  - **Output**: Complete test files with proper assertions and mocking

### 📚 Documentation
- **`wiki-documentation.prompt.yml`** - Technical documentation generator
  - **Model**: `gpt-4o`
  - **Purpose**: Create comprehensive wiki pages from codebase analysis
  - **Output**: Structured markdown with diagrams and examples

### 🔄 PR Automation
- **`pr-automation.prompt.yml`** - Pull request lifecycle management
  - **Model**: `gpt-4o`
  - **Purpose**: Generate professional PR descriptions and changelogs
  - **Output**: Standardized PR templates with impact assessment

### ⚙️ General Workflow
- **`github-actions-ai.prompt.yml`** - Master workflow assistant
  - **Model**: `gpt-4o`
  - **Purpose**: Universal AI assistant for all GitHub Actions tasks
  - **Output**: Context-aware assistance for any workflow operation

## 🔧 How to Force Actions to Use Specific Prompts

### Method 1: Validate and Force Claude Models
```yaml
- name: Force Load Claude Prompt
  id: load-prompt
  run: |
    # Verify we're using Claude (not GPT)
    MODEL_ID=$(yq '.model' .prompts/security-code-review.prompt.yml)
    if [[ "$MODEL_ID" != claude-* ]]; then
      echo "❌ ERROR: Expected Claude model, got $MODEL_ID"
      exit 1
    fi
    echo "model-id=$MODEL_ID" >> $GITHUB_OUTPUT

- name: Security Review with Verified Claude
  run: |
    curl -X POST "https://api.anthropic.com/v1/messages" \
      -H "Content-Type: application/json" \
      -H "x-api-key: ${{ secrets.ANTHROPIC_API_KEY }}" \
      -H "anthropic-version: 2023-06-01" \
      -d '{"model":"'${{ steps.load-prompt.outputs.model-id }}'","max_tokens":4000,"messages":[...]}'
```

### Method 2: Direct Prompt Enforcement
```yaml
- name: Ensure Claude for Heavy Code Work
  run: |
    # Check all prompts use Claude models
    for prompt in .prompts/*.prompt.yml; do
      MODEL=$(yq '.model' "$prompt")
      if [[ ! "$MODEL" =~ ^claude- ]]; then
        echo "❌ $prompt uses $MODEL - Claude required for code work!"
        exit 1
      fi
    done
    echo "✅ All prompts use Claude models"

- name: Execute with Claude Opus
  run: |
    REQUEST_BODY='{"model":"claude-3-opus-20240229","max_tokens":4000,"messages":[...]}'
    curl -X POST "https://api.anthropic.com/v1/messages" \
      -H "Content-Type: application/json" \
      -H "x-api-key: ${{ secrets.ANTHROPIC_API_KEY }}" \
      -H "anthropic-version: 2023-06-01" \
      -d "$REQUEST_BODY" \
      -o output.json
```

## 🎯 Model Selection Strategy

| Use Case | Model | Reasoning |
|----------|--------|-----------|
| **Security Review** | Claude Opus 4.1 | Superior reasoning for complex security analysis |
| **Test Generation** | GPT-4o | Excellent code generation and structured output |
| **Documentation** | GPT-4o | Strong technical writing and formatting |
| **PR Automation** | GPT-4o | Consistent formatting and structured templates |
| **General Tasks** | GPT-4o | Balanced performance and cost efficiency |

## 📊 Available Models via AWS Bedrock

### Anthropic Models (Direct API)
- **Claude 3 Opus**: `claude-3-opus-20240229` ⭐ **Best for Security**
- **Claude 3.5 Sonnet**: `claude-3-5-sonnet-20241022`
- **Claude 3 Sonnet**: `claude-3-sonnet-20240229`
- **Claude 3 Haiku**: `claude-3-haiku-20240307`

### Required Secrets
```bash
# GitHub Repository Secrets needed:
PAT_TOKEN                # GitHub API access with repo + workflow permissions
ANTHROPIC_API_KEY        # Direct Anthropic API for Claude models
```

## 🔄 Prompt Template Variables

All prompts support these common variables:
- `{{event_type}}` - GitHub event (push, pull_request, etc.)
- `{{repository}}` - Repository name
- `{{branch}}` - Current branch
- `{{changed_files}}` - List of modified files
- `{{pr_number}}` - Pull request number
- `{{context}}` - Additional context data

## 🚀 Integration Examples

### Security Review Integration
```yaml
# In .github/workflows/ai-code-review.yml
- name: Security Analysis
  env:
    FILES: ${{ steps.changed-files.outputs.files }}
  run: |
    # Load security prompt and analyze with Claude Opus
    curl -X POST "https://api.anthropic.com/v1/messages" \
      -H "Content-Type: application/json" \
      -H "x-api-key: ${{ secrets.ANTHROPIC_API_KEY }}" \
      -H "anthropic-version: 2023-06-01" \
      -d '{"model":"claude-3-opus-20240229","max_tokens":4000,"messages":[{"role":"user","content":"Security analysis..."}]}'
```

### Test Generation Integration
```yaml
# In .github/workflows/ai-test-generation.yml
- name: Generate Tests
  env:
    CHANGES: ${{ steps.get-changes.outputs.diff }}
  run: |
    # Use test generation prompt with Claude Sonnet 3.5
    curl -X POST "https://api.anthropic.com/v1/messages" \
      -H "Content-Type: application/json" \
      -H "x-api-key: ${{ secrets.ANTHROPIC_API_KEY }}" \
      -H "anthropic-version: 2023-06-01" \
      -d '{"model":"claude-3-5-sonnet-20241022","max_tokens":4000,"messages":[{"role":"user","content":"Generate tests..."}]}'
```

## 📈 Performance Optimization

### Model Cost Optimization
- **Security Reviews**: Use Claude 3 Opus only for critical analysis
- **Routine Tasks**: Use Claude 3.5 Sonnet for cost efficiency
- **Bulk Operations**: Batch requests to reduce API calls

### Response Caching
- Cache model responses for identical file changes
- Use GitHub Actions cache for prompt results
- Implement deduplication for repeated analyses

## 🔗 Related Documentation

- [GitHub Models Documentation](https://docs.github.com/en/github-models/use-github-models/storing-prompts-in-github-repositories)
- [Anthropic Claude Models](https://docs.anthropic.com/claude/reference/messages)
- [OpenAgenticChat Architecture](../../wiki/Technical-Architecture)
- [Security Guidelines](../../wiki/Security)