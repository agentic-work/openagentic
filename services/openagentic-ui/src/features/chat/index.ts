/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

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