/**
 * Title Regenerator Component
 * 
 * Allows users to regenerate session titles using AI
 * with different styles and preview options
 */

import React, { useState, useCallback } from 'react';
import { RefreshCw, Sparkles, Type, FileText, Palette } from '@/shared/icons';
import { apiEndpoint } from '@/utils/api';
import { useAuth } from '@/app/providers/AuthContext';

interface TitleRegeneratorProps {
  sessionId: string;
  currentTitle: string;
  onTitleUpdate: (newTitle: string) => void;
  className?: string;
}

type TitleStyle = 'concise' | 'descriptive' | 'creative';

interface StyleOption {
  value: TitleStyle;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const STYLE_OPTIONS: StyleOption[] = [
  {
    value: 'concise',
    label: 'Concise',
    icon: <Type className="w-4 h-4" />,
    description: 'Short and to the point (2-4 words)'
  },
  {
    value: 'descriptive',
    label: 'Descriptive',
    icon: <FileText className="w-4 h-4" />,
    description: 'Clear and informative (4-7 words)'
  },
  {
    value: 'creative',
    label: 'Creative',
    icon: <Palette className="w-4 h-4" />,
    description: 'Engaging and unique'
  }
];

export const TitleRegenerator: React.FC<TitleRegeneratorProps> = ({
  sessionId,
  currentTitle,
  onTitleUpdate,
  className = ''
}) => {
  const { getAccessToken } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<TitleStyle>('concise');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const generateTitle = useCallback(async (style: TitleStyle = selectedStyle) => {
    setIsLoading(true);
    setError(null);
    setSuggestions([]);

    try {
      const token = await getAccessToken(['User.Read']);
      const response = await fetch(apiEndpoint(`/chat/sessions/${sessionId}/title`), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-OpenAgentic-Frontend': 'true'
        },
        body: JSON.stringify({
          sessionId,
          style,
          regenerate: true
        })
      });

      if (!response.ok) {
        throw new Error('Failed to generate title');
      }

      const data = await response.json();
      
      // Get additional suggestions
      await getSuggestions(style);
      
      // Update the main title
      if (data.title) {
        onTitleUpdate(data.title);
      }

    } catch (err: any) {
      setError(err.message || 'Failed to generate title');
      console.error('Title generation error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [sessionId, selectedStyle, getAccessToken, onTitleUpdate]);

  const getSuggestions = useCallback(async (style: TitleStyle) => {
    try {
      // Get the first message from the session to generate suggestions
      const token = await getAccessToken(['User.Read']);
      const messagesResponse = await fetch(apiEndpoint(`/chat/sessions/${sessionId}/messages?limit=1`), {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-OpenAgentic-Frontend': 'true'
        }
      });

      if (messagesResponse.ok) {
        const messages = await messagesResponse.json();
        if (messages.length > 0 && messages[0].role === 'user') {
          const suggestResponse = await fetch(apiEndpoint('/chat/title/suggest'), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
              'X-OpenAgentic-Frontend': 'true'
            },
            body: JSON.stringify({
              message: messages[0].content,
              count: 3,
              style
            })
          });

          if (suggestResponse.ok) {
            const data = await suggestResponse.json();
            setSuggestions(data.suggestions || []);
          }
        }
      }
    } catch (err) {
      console.error('Failed to get suggestions:', err);
    }
  }, [sessionId, getAccessToken]);

  const selectSuggestion = useCallback((title: string) => {
    onTitleUpdate(title);
    setIsOpen(false);
    setSuggestions([]);
  }, [onTitleUpdate]);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md
          bg-gray-100 text-gray-600 hover:bg-gray-200 :bg-gray-700 transition-colors ${className}`}
        title="Regenerate title with AI"
      >
        <Sparkles className="w-3 h-3" />
        <span>AI Title</span>
      </button>
    );
  }

  return (
    <div className={`absolute top-full left-0 mt-2 z-50 w-80 p-4 rounded-lg shadow-xl
      bg-white border border-gray-200 ${className}`}>
      
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 
        className="text-sm font-semibold flex items-center gap-2"
        style={{ color: 'var(--color-text)' }}>
          <Sparkles className="w-4 h-4 text-blue-500" />
          AI Title Generator
        </h3>
        <button
          onClick={() => {
            setIsOpen(false);
            setSuggestions([]);
            setError(null);
          }}
          
          className="hover:text-gray-600 :text-gray-300"
          style={{ color: 'var(--color-textMuted)' }}
        >
          ×
        </button>
      </div>

      {/* Current Title */}
      <div className="mb-4">
        <label 
        className="text-xs mb-1 block"
        style={{ color: 'var(--color-textSecondary)' }}>
          Current Title
        </label>
        <div 
        className="px-3 py-2 rounded-md text-sm"
        style={{ backgroundColor: 'var(--color-surface)' }}>
          {currentTitle}
        </div>
      </div>

      {/* Style Selection */}
      <div className="mb-4">
        <label 
        className="text-xs mb-2 block"
        style={{ color: 'var(--color-textSecondary)' }}>
          Title Style
        </label>
        <div className="space-y-2">
          {STYLE_OPTIONS.map((style) => (
            <button
              key={style.value}
              onClick={() => setSelectedStyle(style.value)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors
                ${selectedStyle === style.value
                  ? 'bg-blue-50 border-blue-200 '
                  : 'bg-gray-50 hover:bg-gray-100 :bg-gray-700'
                } border`}
            >
              <span className={`${selectedStyle === style.value ? 'text-blue-500' : 'text-gray-400'}`}>
                {style.icon}
              </span>
              <div className="flex-1">
                <div 
                className="text-sm font-medium"
                style={{ color: 'var(--color-text)' }}>
                  {style.label}
                </div>
                <div 
                className="text-xs"
                style={{ color: 'var(--color-textSecondary)' }}>
                  {style.description}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Generate Button */}
      <button
        onClick={() => generateTitle(selectedStyle)}
        disabled={isLoading}
        className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-md
          font-medium transition-colors ${
          isLoading
            ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
            : 'bg-blue-500 hover:bg-blue-600 text-white'
        }`}
      >
        {isLoading ? (
          <>
            <RefreshCw className="w-4 h-4 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <RefreshCw className="w-4 h-4" />
            Generate Title
          </>
        )}
      </button>

      {/* Error Message */}
      {error && (
        <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded-md">
          <p className="text-xs text-red-600">{error}</p>
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="mt-4">
          <label 
          className="text-xs mb-2 block"
          style={{ color: 'var(--color-textSecondary)' }}>
            Alternative Suggestions
          </label>
          <div className="space-y-2">
            {suggestions.map((suggestion, index) => (
              <button
                key={index}
                onClick={() => selectSuggestion(suggestion)}
                className="w-full px-3 py-2 text-left text-sm rounded-md
                  bg-gray-50 hover:bg-gray-100 :bg-gray-700
                 text-gray-900 transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Tips */}
      <div className="mt-4 p-2 bg-blue-50 rounded-md">
        <p className="text-xs text-blue-600">
          💡 Tip: AI generates titles based on your conversation content. 
          Try different styles for varied results!
        </p>
      </div>
    </div>
  );
};

export default TitleRegenerator;