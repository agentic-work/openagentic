/**
 * Model / LLM node config groups: MCP tool, generic LLM completion, the
 * OpenAgentic LLM node, Bedrock, Vertex, Azure AI, and the reasoning node.
 */

import React from 'react';
import { AlertCircle } from '@/shared/icons';
import { isFieldRequired } from '../../../utils/workflowValidator';
import { FormInput, FormTextarea, FormSelect } from '../FormControls';
import { AdvancedToggle } from '../AdvancedToggle';
import type { NodeConfigContext } from '../types';

export const MCPToolConfig: React.FC<NodeConfigContext> = ({ editor, availableTools }) => {
  const { nodeData, updateData, selectValue } = editor;
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="node-mcp-tool" className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          MCP Tool
          {' '}
          <span style={{ color: 'var(--color-warning)', marginLeft: 4, fontWeight: 800 }}>*</span>
        </label>
        <select
          id="node-mcp-tool"
          value={nodeData.toolName || ''}
          onChange={(e) => {
            const selectedTool = availableTools.find(t => t.name === e.target.value);
            updateData('toolName', e.target.value);
            if (selectedTool) {
              updateData('serverName', selectedTool.server);
              updateData('toolServer', selectedTool.server);
              // Build default arguments from schema with default values
              if (selectedTool.inputSchema?.properties) {
                const defaults: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(selectedTool.inputSchema.properties)) {
                  if (v.default != null) defaults[k] = v.default;
                }
                updateData('arguments', defaults);
              }
            }
          }}
          className="glass-field px-3 py-2 focus:outline-none"
          style={!nodeData.toolName ? {
            borderColor: 'var(--color-warning)',
            boxShadow: '0 0 0 1px color-mix(in srgb, var(--color-warning) 30%, transparent)',
          } : undefined}
        >
          <option value="">Select a tool...</option>
          {availableTools.map((tool) => (
            <option key={`${tool.server}-${tool.name}`} value={tool.name}>
              {tool.name} ({tool.server})
            </option>
          ))}
        </select>
        {nodeData.toolName && (
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Server: {nodeData.serverName}
          </p>
        )}
        {!nodeData.toolName && (
          <p className="text-xs mt-1 flex items-center gap-1" style={{ color: 'var(--color-warning)' }}>
            <AlertCircle style={{ width: 10, height: 10 }} /> Required — select an MCP tool
          </p>
        )}
      </div>

      {/* Schema-driven argument builder */}
      {(() => {
        const selectedTool = availableTools.find(t => t.name === nodeData.toolName);
        const schema = selectedTool?.inputSchema;
        const properties = schema?.properties || {};
        const required = schema?.required || [];
        const hasSchema = Object.keys(properties).length > 0;
        const args = typeof nodeData.arguments === 'object' && nodeData.arguments !== null ? nodeData.arguments : {};

        if (hasSchema) {
          return (
            <div className="space-y-3">
              <span className="block text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
                Arguments
              </span>
              {Object.entries(properties).map(([key, prop]) => {
                const isRequired = required.includes(key);
                const value = (args as Record<string, unknown>)[key] ?? prop.default ?? '';
                return (
                  <div key={key}>
                    <label className="block text-xs font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                      {key}
                      {isRequired && <span style={{ color: 'var(--color-warning)', marginLeft: 3 }}>*</span>}
                    </label>
                    {prop.description && (
                      <p className="text-[10px] mb-1" style={{ color: 'var(--color-text-tertiary)' }}>
                        {prop.description}
                      </p>
                    )}
                    {prop.enum ? (
                      <select
                        value={String(value)}
                        onChange={(e) => {
                          const newArgs = { ...args, [key]: e.target.value };
                          updateData('arguments', newArgs);
                        }}
                        className="glass-field px-2 py-1.5 text-sm focus:outline-none"
                      >
                        <option value="">Select...</option>
                        {prop.enum.map((v: string) => <option key={v} value={v}>{v}</option>)}
                      </select>
                    ) : prop.type === 'boolean' ? (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={!!value}
                          onChange={(e) => {
                            const newArgs = { ...args, [key]: e.target.checked };
                            updateData('arguments', newArgs);
                          }}
                          className="rounded"
                        />
                        <span className="text-xs" style={{ color: 'var(--color-text)' }}>{value ? 'true' : 'false'}</span>
                      </label>
                    ) : prop.type === 'number' || prop.type === 'integer' ? (
                      <input
                        type="number"
                        value={typeof value === 'number' ? value : String(value ?? '')}
                        onChange={(e) => {
                          const newArgs = { ...args, [key]: e.target.value ? Number(e.target.value) : '' };
                          updateData('arguments', newArgs);
                        }}
                        placeholder={prop.default != null ? String(prop.default) : ''}
                        className="glass-field px-2 py-1.5 text-sm focus:outline-none"
                      />
                    ) : (
                      <input
                        type="text"
                        value={String(value)}
                        onChange={(e) => {
                          const newArgs = { ...args, [key]: e.target.value };
                          updateData('arguments', newArgs);
                        }}
                        placeholder={prop.default != null ? String(prop.default) : `Enter ${key}...`}
                        className="glass-field px-2 py-1.5 text-sm focus:outline-none"
                      />
                    )}
                  </div>
                );
              })}
              <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                Use {'{{nodeId.content}}'} or {'{{trigger.body.*}}'} for dynamic values from previous nodes.
              </p>
            </div>
          );
        }

        // Fallback: raw JSON editor when no schema available
        return (
          <div>
            <label htmlFor="node-arguments-json" className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
              Arguments (JSON)
            </label>
            <textarea
              id="node-arguments-json"
              value={typeof nodeData.arguments === 'string' ? nodeData.arguments : JSON.stringify(nodeData.arguments || {}, null, 2)}
              onChange={(e) => {
                try {
                  const parsed = JSON.parse(e.target.value);
                  updateData('arguments', parsed);
                } catch {
                  updateData('arguments', selectValue(e, 'arguments'));
                }
              }}
              rows={6}
              className="glass-field px-3 py-2 font-mono text-sm focus:outline-none"
              placeholder='{}'
            />
            <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
              JSON object of arguments passed to the tool. Use {'{{input}}'} for dynamic values from previous nodes.
            </p>
          </div>
        );
      })()}
    </div>
  );
};

export const LLMConfig: React.FC<NodeConfigContext> = ({ editor, availableModels }) => {
  const { nodeData, updateData } = editor;
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="node-llm-model" className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Model
        </label>
        <select
          id="node-llm-model"
          value={nodeData.model || ''}
          onChange={(e) => updateData('model', e.target.value)}
          className="glass-field px-3 py-2 focus:outline-none"
        >
          <option value="auto">Auto (platform default)</option>
          {availableModels.map((model) => (
            <option key={model} value={model}>
              {model}
            </option>
          ))}
        </select>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          Select a model from configured providers, or use Auto to let the platform route automatically.
        </p>
      </div>

      <FormTextarea
        label="System Prompt"
        value={nodeData.systemPrompt || ''}
        onChange={(v) => updateData('systemPrompt', v)}
        rows={3}
        placeholder="You are a helpful assistant..."
        helpText="System prompt sets the AI's persona and instructions. Use {{variables}} for dynamic values."
      />

      <FormTextarea
        label="User Prompt Template"
        value={nodeData.prompt || ''}
        onChange={(v) => updateData('prompt', v)}
        rows={4}
        placeholder="Use {{variable}} for input data..."
        helpText="Use {{input}} to reference previous node output"
        required={isFieldRequired('llm_completion', 'prompt')}
        error={isFieldRequired('llm_completion', 'prompt') && !nodeData.prompt?.trim()}
      />

      <div>
        <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Temperature: {nodeData.temperature ?? 0.7}
        </label>
        <input
          type="range"
          min="0"
          max="2"
          step="0.1"
          value={nodeData.temperature ?? 0.7}
          onChange={(e) => updateData('temperature', Number.parseFloat(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-text-muted">
          <span>Precise</span>
          <span>Creative</span>
        </div>
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          Temperature controls randomness. 0 = deterministic, 1 = creative, 2 = very random.
        </p>
      </div>

      <div>
        <label htmlFor="node-llm-max-tokens" className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
          Max Tokens
        </label>
        <input
          id="node-llm-max-tokens"
          type="number"
          value={nodeData.maxTokens || 1000}
          onChange={(e) => updateData('maxTokens', Number.parseInt(e.target.value))}
          min="1"
          max="32000"
          className="glass-field px-3 py-2 focus:outline-none"
        />
        <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
          Maximum tokens the model can generate in its response. Higher values allow longer outputs but cost more.
        </p>
      </div>
    </div>
  );
};

export const OpenagenticLLMConfig: React.FC<NodeConfigContext> = ({ editor, isDark, availableModels, showAdvanced, setShowAdvanced }) => {
  const { nodeData, updateData, fieldStr, fieldBool, fieldNum } = editor;
  return (
    <div className="space-y-4">
      {/* 2026-04-19 — Intelligence slider removed (task #144). Model
          selection goes through SmartModelRouter; admin configures
          per-user × per-model budgets in the User Permissions view. */}
      <FormTextarea
        label="System Prompt"
        value={nodeData.systemPrompt || ''}
        onChange={(v) => updateData('systemPrompt', v)}
        rows={3}
        placeholder="You are a helpful assistant..."
        isDark={isDark}
        helpText="System prompt sets the AI's persona and instructions. Use {{variables}} for dynamic values."
      />
      <FormTextarea
        label="User Prompt"
        value={nodeData.prompt || ''}
        onChange={(v) => updateData('prompt', v)}
        rows={4}
        placeholder="Use {{input}} for previous node output..."
        isDark={isDark}
        helpText="Use {{input}} to reference previous node output"
        required={isFieldRequired('openagentic_llm', 'prompt')}
        error={isFieldRequired('openagentic_llm', 'prompt') && !nodeData.prompt?.trim()}
      />
      <FormSelect
        label="Model Override"
        value={fieldStr('modelOverride', 'auto')}
        onChange={(v) => updateData('modelOverride', v)}
        options={[
          { value: 'auto', label: 'Auto (Smart Router)' },
          ...availableModels.map(m => ({ value: m, label: m })),
        ]}
        isDark={isDark}
        helpText="Pin a specific model for this node; leave on Auto for Smart Router."
      />
      <AdvancedToggle show={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)}>
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Temperature: {nodeData.temperature ?? 0.7}
          </label>
          <input type="range" min="0" max="2" step="0.1" value={nodeData.temperature ?? 0.7}
            onChange={(e) => updateData('temperature', Number.parseFloat(e.target.value))} className="w-full" />
          <div className="flex justify-between text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            <span>Precise</span><span>Creative</span>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Temperature controls randomness. 0 = deterministic, 1 = creative, 2 = very random.
          </p>
        </div>
        <FormInput label="Max Tokens" value={nodeData.maxTokens || 4096}
          onChange={(v) => updateData('maxTokens', Number.parseInt(v) || 4096)} type="number" isDark={isDark} min={1} max={32000}
          helpText="Maximum tokens the model can generate. Higher values allow longer outputs but cost more." />
        <div className="flex items-center gap-3 py-1">
          <input type="checkbox" checked={fieldBool('enableThinking')}
            onChange={(e) => updateData('enableThinking', e.target.checked)}
            className="rounded" id="enable-thinking" />
          <label htmlFor="enable-thinking" className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Enable extended thinking
          </label>
        </div>
        <p className="text-xs -mt-2 ml-7" style={{ color: 'var(--color-text-tertiary)' }}>
          Allows the model to reason step-by-step before responding. Improves accuracy on complex tasks.
        </p>
        {fieldBool('enableThinking') && (
          <FormInput label="Thinking Budget (tokens)" value={fieldNum('thinkingBudget', 8192)}
            onChange={(v) => updateData('thinkingBudget', Number.parseInt(v) || 8192)} type="number" isDark={isDark}
            min={1024} max={32000} helpText="Token budget for the thinking phase" />
        )}
      </AdvancedToggle>
    </div>
  );
};

export const BedrockConfig: React.FC<NodeConfigContext> = ({ editor, isDark, showAdvanced, setShowAdvanced }) => {
  const { nodeData, updateData, fieldStr } = editor;
  return (
    <div className="space-y-4">
      <FormInput
        label="Model ID"
        value={fieldStr('modelId')}
        onChange={(v) => updateData('modelId', v)}
        placeholder="us.anthropic.claude-opus-4-6-v1"
        isDark={isDark}
        helpText="Bedrock model identifier"
      />
      <FormSelect
        label="Region"
        value={fieldStr('region', 'us-east-1')}
        onChange={(v) => updateData('region', v)}
        options={[
          { value: 'us-east-1', label: 'US East (N. Virginia)' },
          { value: 'us-west-2', label: 'US West (Oregon)' },
          { value: 'eu-west-1', label: 'EU (Ireland)' },
        ]}
        isDark={isDark}
        helpText="AWS region where the Bedrock model is deployed"
      />
      <FormTextarea
        label="Prompt"
        value={nodeData.prompt || ''}
        onChange={(v) => updateData('prompt', v)}
        rows={4}
        placeholder="Use {{input}} for previous node output..."
        isDark={isDark}
        helpText="Use {{input}} to reference previous node output. Supports Mustache-style templates."
        required={isFieldRequired('bedrock', 'prompt')}
        error={isFieldRequired('bedrock', 'prompt') && !nodeData.prompt?.trim()}
      />
      <AdvancedToggle show={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)}>
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Temperature: {nodeData.temperature ?? 0.7}
          </label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={nodeData.temperature ?? 0.7}
            onChange={(e) => updateData('temperature', Number.parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            <span>Precise</span>
            <span>Creative</span>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Temperature controls randomness. 0 = deterministic, 1 = creative, 2 = very random.
          </p>
        </div>
        <FormInput
          label="Max Tokens"
          value={nodeData.maxTokens || 1000}
          onChange={(v) => updateData('maxTokens', Number.parseInt(v) || 1000)}
          type="number"
          isDark={isDark}
          min={1}
          max={32000}
          helpText="Maximum tokens the model can generate in its response."
        />
      </AdvancedToggle>
    </div>
  );
};

export const VertexConfig: React.FC<NodeConfigContext> = ({ editor, isDark, showAdvanced, setShowAdvanced }) => {
  const { nodeData, updateData, fieldStr } = editor;
  return (
    <div className="space-y-4">
      <FormInput
        label="Model ID"
        value={fieldStr('modelId')}
        onChange={(v) => updateData('modelId', v)}
        placeholder="gemini-2.0-flash"
        isDark={isDark}
        helpText="Vertex AI model identifier"
      />
      <FormInput
        label="Location"
        value={fieldStr('location', 'us-central1')}
        onChange={(v) => updateData('location', v)}
        placeholder="us-central1"
        isDark={isDark}
        helpText="GCP region for the Vertex AI endpoint"
      />
      <FormTextarea
        label="Prompt"
        value={nodeData.prompt || ''}
        onChange={(v) => updateData('prompt', v)}
        rows={4}
        placeholder="Use {{input}} for previous node output..."
        isDark={isDark}
        helpText="Use {{input}} to reference previous node output. Supports Mustache-style templates."
        required={isFieldRequired('vertex', 'prompt')}
        error={isFieldRequired('vertex', 'prompt') && !nodeData.prompt?.trim()}
      />
      <AdvancedToggle show={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)}>
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Temperature: {nodeData.temperature ?? 0.7}
          </label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={nodeData.temperature ?? 0.7}
            onChange={(e) => updateData('temperature', Number.parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            <span>Precise</span>
            <span>Creative</span>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Temperature controls randomness. 0 = deterministic, 1 = creative, 2 = very random.
          </p>
        </div>
        <FormInput
          label="Max Tokens"
          value={nodeData.maxTokens || 1000}
          onChange={(v) => updateData('maxTokens', Number.parseInt(v) || 1000)}
          type="number"
          isDark={isDark}
          min={1}
          max={32000}
          helpText="Maximum tokens the model can generate in its response."
        />
      </AdvancedToggle>
    </div>
  );
};

export const AzureAIConfig: React.FC<NodeConfigContext> = ({ editor, isDark, showAdvanced, setShowAdvanced }) => {
  const { nodeData, updateData, fieldStr } = editor;
  return (
    <div className="space-y-4">
      <FormInput
        label="Deployment Name"
        value={fieldStr('deploymentName')}
        onChange={(v) => updateData('deploymentName', v)}
        placeholder="gpt-4o-deployment"
        isDark={isDark}
        helpText="Azure OpenAI deployment name"
        required={isFieldRequired('azure_ai', 'deploymentName')}
        error={isFieldRequired('azure_ai', 'deploymentName') && !(fieldStr('deploymentName') || fieldStr('deployment'))}
      />
      <FormTextarea
        label="Prompt"
        value={nodeData.prompt || ''}
        onChange={(v) => updateData('prompt', v)}
        rows={4}
        placeholder="Use {{input}} for previous node output..."
        isDark={isDark}
        helpText="Use {{input}} to reference previous node output. Supports Mustache-style templates."
        required={isFieldRequired('azure_ai', 'prompt')}
        error={isFieldRequired('azure_ai', 'prompt') && !nodeData.prompt?.trim()}
      />
      <AdvancedToggle show={showAdvanced} onToggle={() => setShowAdvanced(!showAdvanced)}>
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--color-text-secondary)' }}>
            Temperature: {nodeData.temperature ?? 0.7}
          </label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={nodeData.temperature ?? 0.7}
            onChange={(e) => updateData('temperature', Number.parseFloat(e.target.value))}
            className="w-full"
          />
          <div className="flex justify-between text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            <span>Precise</span>
            <span>Creative</span>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
            Temperature controls randomness. 0 = deterministic, 1 = creative, 2 = very random.
          </p>
        </div>
        <FormInput
          label="Max Tokens"
          value={nodeData.maxTokens || 1000}
          onChange={(v) => updateData('maxTokens', Number.parseInt(v) || 1000)}
          type="number"
          isDark={isDark}
          min={1}
          max={32000}
          helpText="Maximum tokens the model can generate in its response."
        />
      </AdvancedToggle>
    </div>
  );
};

export const ReasoningConfig: React.FC<NodeConfigContext> = ({ editor, availableModels }) => {
  const { fieldStr, fieldNum, updateData } = editor;
  return (
    <div className="space-y-4">
      <FormTextarea label="Prompt" value={fieldStr('prompt')}
        onChange={(v) => updateData('prompt', v)} rows={5}
        placeholder="Analyze the following data and provide a detailed reasoning..."
        helpText="The reasoning prompt. Supports {{input}} template variables."
        required error={!fieldStr('prompt').trim()} />
      <FormInput label="Thinking Budget (tokens)" value={fieldNum('thinkingBudget', 16384)}
        onChange={(v) => updateData('thinkingBudget', Number.parseInt(v) || 16384)} type="number"
        min={1024} max={131072} helpText="Maximum tokens allocated for chain-of-thought reasoning." />
      <FormSelect label="Model" value={fieldStr('model', 'auto')}
        onChange={(v) => updateData('model', v)}
        options={[
          { value: 'auto', label: 'Auto (platform routing)' },
          ...availableModels.map(m => ({ value: m, label: m })),
        ]}
        helpText="Model to use for reasoning. Auto uses platform model routing." />
      <FormSelect label="Output Format" value={fieldStr('outputFormat', 'text')}
        onChange={(v) => updateData('outputFormat', v)}
        options={[
          { value: 'text', label: 'Text - Plain text output' },
          { value: 'json', label: 'JSON - Structured JSON output' },
          { value: 'markdown', label: 'Markdown - Formatted markdown' },
        ]}
        helpText="Format of the reasoning output." />
    </div>
  );
};
