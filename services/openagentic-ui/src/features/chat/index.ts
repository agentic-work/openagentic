// Chat feature exports
export { default as ChatContainer } from './components/ChatContainer';

// Components
export * from './components/ChatHeader';
export * from './components/ChatInput';
export * from './components/ChatMessages';
export * from './components/ChatSidebar';

// Hooks
export { useSSEChat } from './hooks/useSSEChat';
export { useTextToSpeech } from './hooks/useTextToSpeech';

// Services
export { ModelDiscoveryService } from './services/modelDiscovery.service';

// Types
export type { Message, ChatSession, StreamEvent } from './types/chat.types';