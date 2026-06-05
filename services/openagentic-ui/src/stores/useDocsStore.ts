/**
 * Docs Store - Zustand state management for the documentation system
 * Session-only (no persist) - loads index.json and domain manifests on demand
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

// Types for the documentation index and manifests
export interface DocsIndexDomain {
  domain: string;
  title: string;
  description: string;
  category: string;
  icon: string;
  adminOnly?: boolean;
  itemCount: number;
}

export interface DocsIndex {
  version: string;
  codename?: string;
  generatedAt: string;
  domains: DocsIndexDomain[];
  categories: string[];
}

export interface DocManifestItem {
  id: string;
  name: string;
  type: string;
  description?: string;
  properties?: Record<string, unknown>;
  tags?: string[];
  adminOnly?: boolean;
}

export interface DocManifestSection {
  id: string;
  title: string;
  description?: string;
  items: DocManifestItem[];
}

export interface DocManifest {
  domain: string;
  title: string;
  description: string;
  category: string;
  icon: string;
  adminOnly?: boolean;
  sections: DocManifestSection[];
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface DocsState {
  currentDomain: string | null;
  currentSectionId: string | null;
  expandedCategories: Set<string>;
  searchQuery: string;
  index: DocsIndex | null;
  loadedManifests: Map<string, DocManifest>;
  isLoading: boolean;
  isChatOpen: boolean;
  chatMessages: ChatMessage[];
  isChatStreaming: boolean;
  streamingContent: string;
  suggestedQuestions: string[];
}

interface DocsActions {
  loadIndex: () => Promise<void>;
  loadManifest: (domain: string) => Promise<DocManifest | null>;
  navigateTo: (domain: string, sectionId?: string) => void;
  setSearchQuery: (q: string) => void;
  toggleCategory: (category: string) => void;
  toggleChat: () => void;
  addChatMessage: (role: 'user' | 'assistant', content: string) => void;
  setStreamingContent: (content: string) => void;
  setSuggestedQuestions: (questions: string[]) => void;
  setIsChatStreaming: (streaming: boolean) => void;
  clearChat: () => void;
}

type DocsStore = DocsState & DocsActions;

export const useDocsStore = create<DocsStore>()(
  devtools(
    (set, get) => ({
      // State
      currentDomain: null,
      currentSectionId: null,
      expandedCategories: new Set<string>(),
      searchQuery: '',
      index: null,
      loadedManifests: new Map<string, DocManifest>(),
      isLoading: false,
      isChatOpen: true,
      chatMessages: [],
      isChatStreaming: false,
      streamingContent: '',
      suggestedQuestions: [],

      // Actions
      loadIndex: async () => {
        set({ isLoading: true }, false, 'loadIndex/start');
        try {
          const response = await fetch('/docs/generated/index.json');
          if (!response.ok) {
            throw new Error(`Failed to fetch docs index: ${response.status}`);
          }
          const raw = await response.json();

          // Transform generated index format into store format
          // Generated: { manifests: [...], categories: [{id, title, icon}] }
          // Store:     { domains: [...], categories: string[] }
          const domains: DocsIndexDomain[] = (raw.manifests || []).map((m: any) => ({
            domain: m.domain,
            title: m.title,
            description: m.description,
            category: m.category,
            icon: m.category, // Use category as icon key
            adminOnly: m.adminOnly || false,
            itemCount: m.itemCount || 0,
          }));

          const categoryIds: string[] = (raw.categories || []).map((c: any) =>
            typeof c === 'string' ? c : c.id
          );

          const index: DocsIndex = {
            version: raw.version || '0.0.0',
            codename: raw.codename || '',
            generatedAt: raw.generatedAt || new Date().toISOString(),
            domains,
            categories: categoryIds,
          };

          // Auto-expand all categories
          const expandedCategories = new Set<string>(categoryIds);

          set({
            index,
            isLoading: false,
            expandedCategories,
          }, false, 'loadIndex/success');

          // Auto-navigate to first domain if none selected
          if (!get().currentDomain && index.domains.length > 0) {
            const firstDomain = index.domains[0].domain;
            get().navigateTo(firstDomain);
          }
        } catch (error) {
          console.error('[DocsStore] Failed to load index:', error);
          set({ isLoading: false }, false, 'loadIndex/error');
        }
      },

      loadManifest: async (domain: string) => {
        const { loadedManifests } = get();

        // Return cached if available
        if (loadedManifests.has(domain)) {
          return loadedManifests.get(domain) || null;
        }

        try {
          const response = await fetch(`/docs/generated/${domain}.json`);
          if (!response.ok) {
            throw new Error(`Failed to fetch manifest for ${domain}: ${response.status}`);
          }
          const manifest: DocManifest = await response.json();

          // Cache in loadedManifests
          const newManifests = new Map(get().loadedManifests);
          newManifests.set(domain, manifest);
          set({ loadedManifests: newManifests }, false, `loadManifest/${domain}`);

          return manifest;
        } catch (error) {
          console.error(`[DocsStore] Failed to load manifest for ${domain}:`, error);
          return null;
        }
      },

      navigateTo: (domain: string, sectionId?: string) => {
        set({
          currentDomain: domain,
          currentSectionId: sectionId || null,
        }, false, 'navigateTo');

        // Pre-load the manifest
        get().loadManifest(domain);
      },

      setSearchQuery: (q: string) => {
        set({ searchQuery: q }, false, 'setSearchQuery');
      },

      toggleCategory: (category: string) => {
        const { expandedCategories } = get();
        const newExpanded = new Set(expandedCategories);
        if (newExpanded.has(category)) {
          newExpanded.delete(category);
        } else {
          newExpanded.add(category);
        }
        set({ expandedCategories: newExpanded }, false, 'toggleCategory');
      },

      toggleChat: () => {
        set((state) => ({ isChatOpen: !state.isChatOpen }), false, 'toggleChat');
      },

      addChatMessage: (role: 'user' | 'assistant', content: string) => {
        const message: ChatMessage = {
          id: `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          role,
          content,
        };
        set(
          (state) => ({ chatMessages: [...state.chatMessages, message] }),
          false,
          'addChatMessage'
        );
      },

      setStreamingContent: (content: string) => {
        set({ streamingContent: content }, false, 'setStreamingContent');
      },

      setSuggestedQuestions: (questions: string[]) => {
        set({ suggestedQuestions: questions }, false, 'setSuggestedQuestions');
      },

      setIsChatStreaming: (streaming: boolean) => {
        set({ isChatStreaming: streaming }, false, 'setIsChatStreaming');
      },

      clearChat: () => {
        set({
          chatMessages: [],
          streamingContent: '',
          isChatStreaming: false,
          suggestedQuestions: [],
        }, false, 'clearChat');
      },
    }),
    { name: 'DocsStore' }
  )
);
