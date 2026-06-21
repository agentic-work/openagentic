/**
 * Playground Tab — Interactive model testing with chat
 */
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  RefreshCw, Send, Trash2, Play, MessageSquare, Settings,
} from '@/shared/icons';
import { apiRequest } from '@/utils/api';
import { getProviderIcon } from '../../Shared/ProviderIcons';
import { DbProvider, ModelInfo, PlaygroundMessage } from './constants';

export const PlaygroundTab: React.FC<{
  providers: DbProvider[];
  models: ModelInfo[];
}> = ({ providers, models }) => {
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [prompt, setPrompt] = useState('');
  const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [testType, setTestType] = useState<'chat' | 'streaming' | 'tools'>('chat');
  const [maxTokens, setMaxTokens] = useState(1024);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Group models by provider
  const modelsByProvider = useMemo(() => {
    const groups: Record<string, { provider: DbProvider; models: ModelInfo[] }> = {};
    for (const m of models.filter(m => m.capabilities.chat)) {
      if (!groups[m.providerName]) {
        const p = providers.find(p => p.name === m.providerName);
        if (p) groups[m.providerName] = { provider: p, models: [] };
      }
      if (groups[m.providerName]) {
        groups[m.providerName].models.push(m);
      }
    }
    return groups;
  }, [models, providers]);

  const providerNames = Object.keys(modelsByProvider);

  useEffect(() => {
    if (providerNames.length > 0 && !selectedProvider) {
      setSelectedProvider(providerNames[0]);
      const firstModels = modelsByProvider[providerNames[0]]?.models;
      if (firstModels?.length) setSelectedModel(firstModels[0].name);
    }
  }, [providerNames, selectedProvider, modelsByProvider]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async () => {
    if (!prompt.trim() || !selectedProvider || loading) return;

    const userMsg = prompt.trim();
    setPrompt('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const startTime = Date.now();

      // Build conversation history for multi-turn chat
      const allMessages = [
        ...messages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user' as const, content: userMsg },
      ];

      const res = await apiRequest('/admin/llm-providers/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProvider,
          model: selectedModel,
          testType,
          config: { temperature: 0.7, maxTokens },
          input: { messages: allMessages },
        }),
      });
      const data = await res.json();
      const latency = Date.now() - startTime;

      if (!res.ok) {
        throw new Error(data.error || data.message || `HTTP ${res.status}`);
      }

      // Extract response text from various possible locations
      const responseText = data.response
        || data.content
        || (data.thinking ? `[Thinking]\n${data.thinking}\n\n${data.response || ''}` : '')
        || JSON.stringify(data, null, 2);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: responseText || '(No response)',
        latency,
      }]);
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${err.message}`,
      }]);
    } finally {
      setLoading(false);
    }
  }, [prompt, selectedProvider, selectedModel, testType, maxTokens, messages, loading]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const currentProviderModels = modelsByProvider[selectedProvider]?.models || [];
  const currentProvider = modelsByProvider[selectedProvider]?.provider;

  return (
    <div className="flex gap-4 h-[600px]">
      {/* Sidebar — Settings */}
      <div className="w-64 flex-shrink-0 space-y-4 overflow-y-auto">
        <div className="p-3 rounded-xl border space-y-3" style={{ background: 'var(--color-surfaceSecondary)', borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2">
            <Settings size={13} style={{ color: 'var(--text-muted)' }} />
            <h4 className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Configuration</h4>
          </div>

          {/* Provider */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Provider</label>
            <select
              value={selectedProvider}
              onChange={e => {
                setSelectedProvider(e.target.value);
                const firstModel = modelsByProvider[e.target.value]?.models?.[0];
                if (firstModel) setSelectedModel(firstModel.name);
              }}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg border outline-none"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
            >
              {providerNames.map(name => (
                <option key={name} value={name}>
                  {modelsByProvider[name]?.provider.display_name || name}
                </option>
              ))}
            </select>
          </div>

          {/* Model */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Model</label>
            <select
              value={selectedModel}
              onChange={e => setSelectedModel(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg border outline-none font-mono"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
            >
              {currentProviderModels.map(m => (
                <option key={m.id} value={m.name}>{m.name}</option>
              ))}
            </select>
          </div>

          {/* Test type */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>Test Type</label>
            <div className="flex gap-1">
              {(['chat', 'streaming', 'tools'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTestType(t)}
                  className={`flex-1 px-2 py-1 text-xs font-medium rounded-md border transition-all ${
                    testType === t ? 'shadow-sm' : ''
                  }`}
                  style={{
                    background: testType === t ? 'var(--ap-accent)' : 'transparent',
                    borderColor: testType === t ? 'var(--ap-accent)' : 'var(--color-border)',
                    color: testType === t ? 'white' : 'var(--text-muted)',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* Max tokens */}
          <div>
            <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text-muted)' }}>
              Max Tokens: {maxTokens}
            </label>
            <input
              type="range" min={64} max={8192} step={64} value={maxTokens}
              onChange={e => setMaxTokens(Number(e.target.value))}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
              style={{ accentColor: 'var(--ap-accent)' }}
            />
          </div>
        </div>

        {/* Quick prompts */}
        <div className="p-3 rounded-xl border space-y-2" style={{ background: 'var(--color-surfaceSecondary)', borderColor: 'var(--color-border)' }}>
          <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Quick Prompts</h4>
          {[
            'Say "Hello, World!"',
            'What model are you?',
            'Write a haiku about AI',
            'Explain quantum computing in 2 sentences',
            'Count from 1 to 10',
          ].map(p => (
            <button
              key={p}
              onClick={() => { setPrompt(p); }}
              className="w-full text-left px-2.5 py-1.5 text-xs rounded-lg border transition-all hover:border-[var(--color-fg-subtle)]"
              style={{ borderColor: 'var(--color-border)', color: 'var(--text-secondary)' }}
            >
              {p}
            </button>
          ))}
        </div>

        {/* Clear */}
        <button
          onClick={() => setMessages([])}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all hover:border-[var(--color-err)]"
          style={{ borderColor: 'var(--color-border)', color: 'var(--text-muted)' }}
        >
          <Trash2 size={11} />
          Clear History
        </button>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        {/* Chat header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b" style={{ background: 'var(--color-surfaceSecondary)', borderColor: 'var(--color-border)' }}>
          <div className="flex items-center gap-2">
            {currentProvider && getProviderIcon(currentProvider.provider_type)}
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              {currentProvider?.display_name || selectedProvider}
            </span>
            <code className="text-xs px-1.5 py-0.5 rounded bg-[color-mix(in_srgb,var(--color-fg-subtle)_10%,transparent)] font-mono" style={{ color: 'var(--text-muted)' }}>
              {selectedModel}
            </code>
          </div>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {testType} mode · {maxTokens} tokens
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ background: 'var(--color-surface)' }}>
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <MessageSquare size={32} className="mb-3 opacity-20" style={{ color: 'var(--text-muted)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Model Playground</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Test any model interactively. Select a provider and model, then send a message.
              </p>
            </div>
          )}
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] px-3.5 py-2 rounded-xl text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'rounded-br-sm'
                    : 'rounded-bl-sm'
                }`}
                style={{
                  background: msg.role === 'user' ? 'var(--ap-accent)' : 'var(--color-surfaceSecondary)',
                  color: msg.role === 'user' ? 'white' : 'var(--text-primary)',
                }}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
                {msg.latency ? (
                  <div className="text-xs mt-1 opacity-60">
                    {msg.latency}ms
                  </div>
                ) : null}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="px-3.5 py-2.5 rounded-xl rounded-bl-sm" style={{ background: 'var(--color-surfaceSecondary)' }}>
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--text-muted)', animationDelay: '0ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--text-muted)', animationDelay: '150ms' }} />
                  <div className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: 'var(--text-muted)', animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surfaceSecondary)' }}>
          <div className="flex gap-2">
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message to test the model..."
              rows={1}
              className="flex-1 px-3 py-2 text-xs rounded-lg border outline-none resize-none"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--text-primary)' }}
            />
            <button
              onClick={sendMessage}
              disabled={!prompt.trim() || loading}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium rounded-lg transition-all disabled:opacity-50"
              style={{ background: 'var(--ap-accent)', color: 'var(--color-on-accent)' }}
            >
              <Send size={12} />
              Send
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
