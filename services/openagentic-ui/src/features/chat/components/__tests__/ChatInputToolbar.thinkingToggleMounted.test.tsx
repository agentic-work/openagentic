/**
 * Z.ET.3 — ChatInputToolbar thinking toggle mount tests (2026-05-19).
 *
 * Confirms:
 * - When a thinking-capable model is selected, the extended-thinking toggle
 *   appears in the toolbar's right-side model row (adjacent to ModelSelector)
 * - When a non-thinking model is selected, the toggle does NOT appear
 * - The toggle reads from useModelStore (no prop drilling)
 *
 * RED: these tests should FAIL before the toggle is mounted in ChatInputToolbar.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { useModelStore } from '@/stores/useModelStore';
import { useExtendedThinkingStore } from '@/stores/useExtendedThinkingStore';

// Mock createPortal — the ModelSelectorDropdown uses it; we don't need real
// portal behavior in unit tests.
vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    createPortal: (node: React.ReactNode) => node,
  };
});

// Mock FileAttachmentThumbnails to avoid image-loading complexity
vi.mock('@/features/chat/components/FileAttachmentThumbnails', () => ({
  default: () => null,
}));

import ChatInputToolbar from '@/features/chat/components/ChatInputToolbar';

const thinkingModel = {
  id: 'us.anthropic.claude-sonnet-4-6',
  name: 'Claude Sonnet 4.6',
  thinking: true,
  type: 'chat' as const,
};

const nonThinkingModel = {
  id: 'gpt-4o',
  name: 'GPT-4o',
  thinking: false,
  type: 'chat' as const,
};

const baseProps = {
  isAdmin: true,
  fileInputRef: React.createRef<HTMLInputElement>(),
  availableModels: [thinkingModel, nonThinkingModel] as any[],
  onModelChange: vi.fn(),
  disabled: false,
};

describe('ChatInputToolbar — ExtendedThinkingToggle mount', () => {
  beforeEach(() => {
    useExtendedThinkingStore.setState({ enabled: true });
  });

  it('shows thinking toggle when thinking-capable model is selected', () => {
    useModelStore.setState({ selectedModel: thinkingModel.id, availableModels: [thinkingModel] as any[] });
    render(<ChatInputToolbar {...baseProps} selectedModel={thinkingModel.id} />);
    expect(screen.getByTestId('chat-extended-thinking-toggle')).toBeInTheDocument();
  });

  it('does NOT show thinking toggle when non-thinking model is selected', () => {
    useModelStore.setState({ selectedModel: nonThinkingModel.id, availableModels: [nonThinkingModel] as any[] });
    render(<ChatInputToolbar {...baseProps} selectedModel={nonThinkingModel.id} />);
    expect(screen.queryByTestId('chat-extended-thinking-toggle')).toBeNull();
  });

  it('does NOT show thinking toggle when no model is selected (auto-routing)', () => {
    useModelStore.setState({ selectedModel: '', availableModels: [thinkingModel] as any[] });
    render(<ChatInputToolbar {...baseProps} selectedModel="" />);
    expect(screen.queryByTestId('chat-extended-thinking-toggle')).toBeNull();
  });
});
