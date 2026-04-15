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

/**
 * OpenAgentic AI Extension
 * Provides AI-powered code assistance via the OpenAgentic Code Mode WebSocket API
 *
 * This extension connects to the openagentic-manager service to provide:
 * - Real-time streaming chat with Claude/LLM
 * - File operations (read, write, edit)
 * - Tool calls and results
 * - Extended thinking visualization
 */

import * as vscode from 'vscode';

// ========================================
// Configuration
// ========================================

interface ExtensionConfig {
  managerUrl: string;  // openagentic-manager URL
  token: string;       // User auth token
  userId: string;
  sessionId: string | null;
}

function getConfig(): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('openagentic');

  return {
    // Priority: config > env > default
    managerUrl: config.get('managerUrl')
      || process.env.OPENAGENTIC_MANAGER_URL
      || 'http://localhost:3050',
    token: config.get('token')
      || process.env.OPENAGENTIC_TOKEN
      || '',
    userId: config.get('userId')
      || process.env.USER_ID
      || 'vscode-user',
    sessionId: config.get('sessionId') as string
      || process.env.SESSION_ID
      || null
  };
}

// ========================================
// Event Types (matching openagentic-manager)
// ========================================

interface OpenagenticEvent {
  type: string;
  timestamp: number;
  sessionId: string;
}

interface ThinkingStartEvent extends OpenagenticEvent {
  type: 'thinking_start';
  context?: string;
}

interface ThinkingUpdateEvent extends OpenagenticEvent {
  type: 'thinking_update';
  step: string;
  progress?: number;
}

interface ThinkingEndEvent extends OpenagenticEvent {
  type: 'thinking_end';
}

interface ToolStartEvent extends OpenagenticEvent {
  type: 'tool_use_start' | 'tool_start';
  toolId: string;
  toolName: string;
  input?: Record<string, unknown>;
  args?: Record<string, unknown>;
}

interface ToolEndEvent extends OpenagenticEvent {
  type: 'tool_end' | 'tool_result';
  toolId: string;
  toolName?: string;
  status?: 'success' | 'error';
  output?: string;
  error?: string;
  duration?: number;
}

interface TextEvent extends OpenagenticEvent {
  type: 'text' | 'text_delta';
  text: string;
}

interface MessageEvent extends OpenagenticEvent {
  type: 'message';
  role: 'user' | 'assistant';
  content: string;
}

interface SessionInitEvent extends OpenagenticEvent {
  type: 'session_init' | 'session_started';
  tools?: string[];
  workspacePath?: string;
  model?: string;
}

interface ErrorEvent extends OpenagenticEvent {
  type: 'error';
  message: string;
  recoverable: boolean;
}

type StreamEvent =
  | ThinkingStartEvent
  | ThinkingUpdateEvent
  | ThinkingEndEvent
  | ToolStartEvent
  | ToolEndEvent
  | TextEvent
  | MessageEvent
  | SessionInitEvent
  | ErrorEvent
  | OpenagenticEvent;

// ========================================
// WebSocket Client
// ========================================

class OpenagenticClient {
  private ws: WebSocket | null = null;
  private config: ExtensionConfig;
  private onEvent: (event: StreamEvent) => void;
  private onConnected: (sessionId: string) => void;
  private onDisconnected: () => void;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private currentSessionId: string | null = null;

  constructor(
    config: ExtensionConfig,
    onEvent: (event: StreamEvent) => void,
    onConnected: (sessionId: string) => void,
    onDisconnected: () => void
  ) {
    this.config = config;
    this.onEvent = onEvent;
    this.onConnected = onConnected;
    this.onDisconnected = onDisconnected;
  }

  async connect(): Promise<void> {
    // Build WebSocket URL
    const wsUrl = this.config.managerUrl.replace('http://', 'ws://').replace('https://', 'wss://');
    const params = new URLSearchParams({
      userId: this.config.userId,
      ...(this.config.token ? { token: this.config.token } : {}),
      ...(this.config.sessionId ? { sessionId: this.config.sessionId } : {})
    });

    const fullUrl = `${wsUrl}/events?${params.toString()}`;
    console.log('[OpenAgentic] Connecting to:', fullUrl);

    return new Promise((resolve, reject) => {
      try {
        // Use global WebSocket (available in VS Code)
        this.ws = new WebSocket(fullUrl);

        this.ws.onopen = () => {
          console.log('[OpenAgentic] WebSocket connected');
          this.reconnectAttempts = 0;
        };

        this.ws.onmessage = (event: MessageEvent) => {
          try {
            const data = JSON.parse(event.data as string) as StreamEvent;
            console.log('[OpenAgentic] Event:', data.type);

            // Track session ID from init events
            if (data.type === 'session_init' || data.type === 'session_started') {
              this.currentSessionId = data.sessionId;
              this.onConnected(data.sessionId);
              resolve();
            }

            this.onEvent(data);
          } catch (err) {
            console.error('[OpenAgentic] Parse error:', err);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[OpenAgentic] WebSocket error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('[OpenAgentic] WebSocket closed');
          this.onDisconnected();
          this.attemptReconnect();
        };

        // Timeout for initial connection
        setTimeout(() => {
          if (this.ws?.readyState !== WebSocket.OPEN) {
            reject(new Error('Connection timeout'));
          }
        }, 10000);

      } catch (error) {
        reject(error);
      }
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('[OpenAgentic] Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    console.log(`[OpenAgentic] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    setTimeout(() => {
      this.connect().catch(err => {
        console.error('[OpenAgentic] Reconnect failed:', err);
      });
    }, delay);
  }

  sendMessage(content: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      vscode.window.showErrorMessage('Not connected to OpenAgentic');
      return;
    }

    this.ws.send(JSON.stringify({
      type: 'user_message',
      content
    }));
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get sessionId(): string | null {
    return this.currentSessionId;
  }
}

// ========================================
// Chat View Provider
// ========================================

class OpenagenticChatViewProvider implements vscode.WebviewViewProvider {
  private webviewView: vscode.WebviewView | null = null;
  private client: OpenagenticClient | null = null;
  private messages: Array<{ role: string; content: string; type?: string }> = [];
  private currentThinking = false;
  private currentTools: Map<string, { name: string; input?: unknown }> = new Map();

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.webviewView = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = this.getHtml();

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(message => {
      switch (message.type) {
        case 'connect':
          this.connect();
          break;
        case 'disconnect':
          this.disconnect();
          break;
        case 'send':
          this.sendMessage(message.content);
          break;
      }
    });

    // Auto-connect on view ready
    this.connect();
  }

  private async connect(): Promise<void> {
    const config = getConfig();

    if (!config.managerUrl) {
      this.postMessage({ type: 'error', message: 'Manager URL not configured' });
      return;
    }

    this.client = new OpenagenticClient(
      config,
      (event) => this.handleEvent(event),
      (sessionId) => {
        this.postMessage({ type: 'connected', sessionId });
      },
      () => {
        this.postMessage({ type: 'disconnected' });
      }
    );

    try {
      this.postMessage({ type: 'connecting' });
      await this.client.connect();
    } catch (error) {
      this.postMessage({ type: 'error', message: `Connection failed: ${error}` });
    }
  }

  private disconnect(): void {
    this.client?.disconnect();
    this.client = null;
  }

  private sendMessage(content: string): void {
    if (!this.client?.isConnected) {
      this.postMessage({ type: 'error', message: 'Not connected' });
      return;
    }

    // Add user message to UI
    this.messages.push({ role: 'user', content });
    this.postMessage({ type: 'user_message', content });

    // Send to server
    this.client.sendMessage(content);
  }

  /**
   * Send a message from outside the webview (e.g., from context menu commands)
   */
  public sendMessageFromExtension(content: string): void {
    // If not connected, try to connect first
    if (!this.client?.isConnected) {
      this.connect().then(() => {
        // Wait a bit for connection to establish, then send
        setTimeout(() => {
          this.sendMessage(content);
        }, 500);
      }).catch(err => {
        vscode.window.showErrorMessage(`Failed to connect to OpenAgentic: ${err}`);
      });
      return;
    }

    this.sendMessage(content);
  }

  private handleEvent(event: StreamEvent): void {
    switch (event.type) {
      case 'thinking_start':
        this.currentThinking = true;
        this.postMessage({
          type: 'thinking_start',
          context: (event as ThinkingStartEvent).context
        });
        break;

      case 'thinking_update':
        this.postMessage({
          type: 'thinking_update',
          step: (event as ThinkingUpdateEvent).step,
          progress: (event as ThinkingUpdateEvent).progress
        });
        break;

      case 'thinking_end':
        this.currentThinking = false;
        this.postMessage({ type: 'thinking_end' });
        break;

      case 'tool_use_start':
      case 'tool_start': {
        const toolEvent = event as ToolStartEvent;
        this.currentTools.set(toolEvent.toolId, {
          name: toolEvent.toolName,
          input: toolEvent.input || toolEvent.args
        });
        this.postMessage({
          type: 'tool_start',
          toolId: toolEvent.toolId,
          toolName: toolEvent.toolName,
          input: toolEvent.input || toolEvent.args
        });
        break;
      }

      case 'tool_end':
      case 'tool_result': {
        const toolEndEvent = event as ToolEndEvent;
        const tool = this.currentTools.get(toolEndEvent.toolId);
        this.currentTools.delete(toolEndEvent.toolId);
        this.postMessage({
          type: 'tool_end',
          toolId: toolEndEvent.toolId,
          toolName: tool?.name || toolEndEvent.toolName,
          status: toolEndEvent.status || (toolEndEvent.error ? 'error' : 'success'),
          output: toolEndEvent.output,
          error: toolEndEvent.error
        });
        break;
      }

      case 'text':
      case 'text_delta':
        this.postMessage({
          type: 'text',
          text: (event as TextEvent).text
        });
        break;

      case 'message': {
        const msgEvent = event as MessageEvent;
        this.messages.push({ role: msgEvent.role, content: msgEvent.content });
        this.postMessage({
          type: 'message',
          role: msgEvent.role,
          content: msgEvent.content
        });
        break;
      }

      case 'error':
        this.postMessage({
          type: 'error',
          message: (event as ErrorEvent).message
        });
        break;

      case 'session_init':
      case 'session_started': {
        const initEvent = event as SessionInitEvent;
        this.postMessage({
          type: 'session_info',
          tools: initEvent.tools,
          workspacePath: initEvent.workspacePath,
          model: initEvent.model
        });
        break;
      }
    }
  }

  private postMessage(message: unknown): void {
    this.webviewView?.webview.postMessage(message);
  }

  private getHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OpenAgentic AI</title>
  <style>
    :root {
      --bg-primary: var(--vscode-sideBar-background);
      --bg-secondary: var(--vscode-editor-background);
      --text-primary: var(--vscode-foreground);
      --text-muted: var(--vscode-descriptionForeground);
      --border: var(--vscode-panel-border);
      --accent: var(--vscode-button-background);
      --accent-hover: var(--vscode-button-hoverBackground);
      --success: #22c55e;
      --error: #ef4444;
      --warning: #f59e0b;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      background: var(--bg-primary);
      color: var(--text-primary);
      height: 100vh;
      display: flex;
      flex-direction: column;
    }

    /* Header */
    .header {
      padding: 12px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--text-muted);
    }

    .status-dot.connected { background: var(--success); }
    .status-dot.connecting { background: var(--warning); animation: pulse 1s infinite; }
    .status-dot.error { background: var(--error); }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .connect-btn {
      padding: 4px 12px;
      border: none;
      border-radius: 4px;
      background: var(--accent);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font-size: 12px;
    }

    .connect-btn:hover { background: var(--accent-hover); }
    .connect-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Messages */
    #messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .message {
      padding: 10px 14px;
      border-radius: 8px;
      max-width: 90%;
      word-wrap: break-word;
    }

    .message.user {
      align-self: flex-end;
      background: var(--accent);
      color: var(--vscode-button-foreground);
    }

    .message.assistant {
      align-self: flex-start;
      background: var(--bg-secondary);
      border: 1px solid var(--border);
    }

    .message.system {
      align-self: center;
      background: transparent;
      color: var(--text-muted);
      font-size: 11px;
      font-style: italic;
    }

    /* Activity blocks */
    .activity-block {
      padding: 8px 12px;
      border-radius: 6px;
      background: var(--bg-secondary);
      border-left: 3px solid var(--accent);
      font-size: 12px;
    }

    .activity-block.thinking {
      border-left-color: var(--warning);
    }

    .activity-block.tool {
      border-left-color: #8b5cf6;
    }

    .activity-block.error {
      border-left-color: var(--error);
    }

    .activity-header {
      display: flex;
      align-items: center;
      gap: 6px;
      font-weight: 500;
      margin-bottom: 4px;
    }

    .activity-content {
      color: var(--text-muted);
      white-space: pre-wrap;
      max-height: 150px;
      overflow-y: auto;
    }

    .spinner {
      width: 12px;
      height: 12px;
      border: 2px solid var(--text-muted);
      border-top-color: transparent;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    /* Input */
    .input-container {
      padding: 12px;
      border-top: 1px solid var(--border);
      display: flex;
      gap: 8px;
    }

    #user-input {
      flex: 1;
      padding: 10px 12px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--bg-secondary);
      color: var(--text-primary);
      font-family: inherit;
      font-size: inherit;
      resize: none;
      min-height: 40px;
      max-height: 150px;
    }

    #user-input:focus {
      outline: none;
      border-color: var(--accent);
    }

    #send-btn {
      padding: 10px 16px;
      border: none;
      border-radius: 6px;
      background: var(--accent);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font-weight: 500;
    }

    #send-btn:hover { background: var(--accent-hover); }
    #send-btn:disabled { opacity: 0.5; cursor: not-allowed; }

    /* Code blocks */
    code {
      font-family: var(--vscode-editor-font-family);
      background: var(--bg-secondary);
      padding: 2px 6px;
      border-radius: 3px;
    }

    pre {
      background: var(--bg-secondary);
      padding: 10px;
      border-radius: 6px;
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="status">
      <div class="status-dot" id="status-dot"></div>
      <span id="status-text">Disconnected</span>
    </div>
    <button class="connect-btn" id="connect-btn">Connect</button>
  </div>

  <div id="messages">
    <div class="message system">Welcome to OpenAgentic AI. Click Connect to start.</div>
  </div>

  <div class="input-container">
    <textarea id="user-input" placeholder="Ask me anything..." rows="1" disabled></textarea>
    <button id="send-btn" disabled>Send</button>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    const messages = document.getElementById('messages');
    const input = document.getElementById('user-input');
    const sendBtn = document.getElementById('send-btn');
    const connectBtn = document.getElementById('connect-btn');
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');

    let isConnected = false;
    let currentAssistantMessage = null;
    let currentThinkingBlock = null;
    let currentToolBlocks = new Map();

    // Auto-resize textarea
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 150) + 'px';
    });

    // Send message
    function sendMessage() {
      const content = input.value.trim();
      if (!content || !isConnected) return;

      vscode.postMessage({ type: 'send', content });
      input.value = '';
      input.style.height = 'auto';
    }

    sendBtn.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });

    // Connect/disconnect
    connectBtn.addEventListener('click', () => {
      if (isConnected) {
        vscode.postMessage({ type: 'disconnect' });
      } else {
        vscode.postMessage({ type: 'connect' });
      }
    });

    // Handle messages from extension
    window.addEventListener('message', (event) => {
      const msg = event.data;

      switch (msg.type) {
        case 'connecting':
          setStatus('connecting', 'Connecting...');
          connectBtn.disabled = true;
          break;

        case 'connected':
          isConnected = true;
          setStatus('connected', 'Connected');
          connectBtn.textContent = 'Disconnect';
          connectBtn.disabled = false;
          input.disabled = false;
          sendBtn.disabled = false;
          addSystemMessage('Connected to session: ' + msg.sessionId);
          break;

        case 'disconnected':
          isConnected = false;
          setStatus('disconnected', 'Disconnected');
          connectBtn.textContent = 'Connect';
          connectBtn.disabled = false;
          input.disabled = true;
          sendBtn.disabled = true;
          break;

        case 'error':
          setStatus('error', 'Error');
          addSystemMessage('Error: ' + msg.message);
          break;

        case 'user_message':
          addUserMessage(msg.content);
          break;

        case 'thinking_start':
          startThinking(msg.context);
          break;

        case 'thinking_update':
          updateThinking(msg.step);
          break;

        case 'thinking_end':
          endThinking();
          break;

        case 'tool_start':
          startTool(msg.toolId, msg.toolName, msg.input);
          break;

        case 'tool_end':
          endTool(msg.toolId, msg.status, msg.output, msg.error);
          break;

        case 'text':
          appendText(msg.text);
          break;

        case 'message':
          if (msg.role === 'assistant') {
            finalizeAssistantMessage(msg.content);
          }
          break;

        case 'session_info':
          addSystemMessage('Model: ' + (msg.model || 'default') + ' | Tools: ' + (msg.tools?.length || 0));
          break;
      }
    });

    function setStatus(state, text) {
      statusDot.className = 'status-dot ' + state;
      statusText.textContent = text;
    }

    function addSystemMessage(content) {
      const div = document.createElement('div');
      div.className = 'message system';
      div.textContent = content;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    function addUserMessage(content) {
      const div = document.createElement('div');
      div.className = 'message user';
      div.textContent = content;
      messages.appendChild(div);
      messages.scrollTop = messages.scrollHeight;
    }

    function startThinking(context) {
      if (!currentThinkingBlock) {
        currentThinkingBlock = document.createElement('div');
        currentThinkingBlock.className = 'activity-block thinking';
        currentThinkingBlock.innerHTML = \`
          <div class="activity-header">
            <div class="spinner"></div>
            <span>Thinking...</span>
          </div>
          <div class="activity-content">\${context || ''}</div>
        \`;
        messages.appendChild(currentThinkingBlock);
        messages.scrollTop = messages.scrollHeight;
      }
    }

    function updateThinking(step) {
      if (currentThinkingBlock) {
        const content = currentThinkingBlock.querySelector('.activity-content');
        if (content) {
          content.textContent = step;
        }
      }
    }

    function endThinking() {
      if (currentThinkingBlock) {
        const header = currentThinkingBlock.querySelector('.activity-header');
        if (header) {
          header.innerHTML = '<span>✓ Thought</span>';
        }
        currentThinkingBlock = null;
      }
    }

    function startTool(toolId, toolName, input) {
      const block = document.createElement('div');
      block.className = 'activity-block tool';
      block.innerHTML = \`
        <div class="activity-header">
          <div class="spinner"></div>
          <span>\${toolName}</span>
        </div>
        <div class="activity-content">\${input ? JSON.stringify(input, null, 2).slice(0, 200) : ''}</div>
      \`;
      messages.appendChild(block);
      currentToolBlocks.set(toolId, block);
      messages.scrollTop = messages.scrollHeight;
    }

    function endTool(toolId, status, output, error) {
      const block = currentToolBlocks.get(toolId);
      if (block) {
        const header = block.querySelector('.activity-header');
        const content = block.querySelector('.activity-content');

        if (status === 'error') {
          block.classList.add('error');
          header.innerHTML = '<span>✗ ' + header.textContent + '</span>';
          content.textContent = error || 'Error';
        } else {
          header.innerHTML = '<span>✓ ' + header.querySelector('span').textContent + '</span>';
          if (output) {
            content.textContent = output.slice(0, 500) + (output.length > 500 ? '...' : '');
          }
        }

        currentToolBlocks.delete(toolId);
      }
    }

    function appendText(text) {
      if (!currentAssistantMessage) {
        currentAssistantMessage = document.createElement('div');
        currentAssistantMessage.className = 'message assistant';
        messages.appendChild(currentAssistantMessage);
      }
      currentAssistantMessage.textContent += text;
      messages.scrollTop = messages.scrollHeight;
    }

    function finalizeAssistantMessage(content) {
      if (currentAssistantMessage) {
        currentAssistantMessage.textContent = content;
      } else {
        const div = document.createElement('div');
        div.className = 'message assistant';
        div.textContent = content;
        messages.appendChild(div);
      }
      currentAssistantMessage = null;
      messages.scrollTop = messages.scrollHeight;
    }
  </script>
</body>
</html>`;
  }
}

// ========================================
// Activity View Provider
// ========================================

class ActivityViewProvider implements vscode.TreeDataProvider<ActivityItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ActivityItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private activities: ActivityItem[] = [];

  addActivity(activity: { type: string; label: string; detail?: string }): void {
    this.activities.unshift(new ActivityItem(
      activity.label,
      activity.detail || '',
      activity.type
    ));

    // Keep only last 50 activities
    if (this.activities.length > 50) {
      this.activities = this.activities.slice(0, 50);
    }

    this._onDidChangeTreeData.fire(undefined);
  }

  clear(): void {
    this.activities = [];
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: ActivityItem): vscode.TreeItem {
    return element;
  }

  getChildren(): ActivityItem[] {
    return this.activities;
  }
}

class ActivityItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly detail: string,
    public readonly activityType: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = detail;
    this.tooltip = `${label}: ${detail}`;

    // Set icon based on type
    switch (activityType) {
      case 'thinking':
        this.iconPath = new vscode.ThemeIcon('lightbulb');
        break;
      case 'tool':
        this.iconPath = new vscode.ThemeIcon('tools');
        break;
      case 'message':
        this.iconPath = new vscode.ThemeIcon('comment');
        break;
      case 'error':
        this.iconPath = new vscode.ThemeIcon('error');
        break;
      default:
        this.iconPath = new vscode.ThemeIcon('circle-outline');
    }
  }
}

// ========================================
// Terminal Blocking - Security Feature
// ========================================

/**
 * Terminal commands that need to be blocked/intercepted.
 * Users should use the OpenAgentic AI assistant for code execution,
 * not direct terminal access.
 */
const TERMINAL_COMMANDS_TO_BLOCK = [
  'workbench.action.terminal.new',
  'workbench.action.terminal.newWithCwd',
  'workbench.action.terminal.newLocal',
  'workbench.action.terminal.newInActiveWorkspace',
  'workbench.action.terminal.toggleTerminal',
  'workbench.action.terminal.focus',
  'workbench.action.terminal.focusAtIndex1',
  'workbench.action.terminal.focusAtIndex2',
  'workbench.action.terminal.focusAtIndex3',
  'workbench.action.terminal.focusNext',
  'workbench.action.terminal.focusPrevious',
  'workbench.action.terminal.focusNextPane',
  'workbench.action.terminal.focusPreviousPane',
  'workbench.action.terminal.split',
  'workbench.action.terminal.splitInstance',
  'workbench.action.terminal.splitActiveWorkspace',
  'workbench.action.terminal.openNativeConsole',
  'workbench.action.terminal.runActiveFile',
  'workbench.action.terminal.runSelectedText',
  'workbench.action.terminal.runRecentCommand',
  'workbench.action.terminal.goToRecentDirectory',
  'workbench.view.terminal',
  'terminal.focus',
];

/**
 * Message shown when user attempts to access terminal
 */
const TERMINAL_BLOCKED_MESSAGE = `Terminal access is disabled for security reasons.

Use the OpenAgentic AI assistant (click the OpenAgentic icon in the sidebar) to:
• Execute code and commands safely
• Run tests and builds
• Manage files and git operations

The AI assistant has sandboxed access to your workspace and can perform all terminal operations on your behalf.`;

/**
 * Show message when terminal access is attempted
 */
function showTerminalBlockedMessage(): void {
  vscode.window.showInformationMessage(
    'Terminal is disabled. Use OpenAgentic AI instead.',
    'Open OpenAgentic AI'
  ).then((selection) => {
    if (selection === 'Open OpenAgentic AI') {
      vscode.commands.executeCommand('openagentic.chatView.focus');
    }
  });
}

/**
 * Register override commands that intercept terminal access attempts
 */
function registerTerminalBlockingCommands(context: vscode.ExtensionContext): void {
  // Register the main terminal disabled command
  context.subscriptions.push(
    vscode.commands.registerCommand('openagentic.terminalDisabled', () => {
      vscode.window.showWarningMessage(TERMINAL_BLOCKED_MESSAGE, 'Open OpenAgentic AI').then((selection) => {
        if (selection === 'Open OpenAgentic AI') {
          vscode.commands.executeCommand('openagentic.chatView.focus');
        }
      });
    })
  );

  // Try to override each terminal command
  // Note: VS Code may not allow overriding built-in commands, but we try anyway
  // The real blocking happens via settings.json, keybindings.json, and SHELL=/bin/false
  for (const cmd of TERMINAL_COMMANDS_TO_BLOCK) {
    try {
      // Check if we can register an override (this usually won't work for built-in commands)
      context.subscriptions.push(
        vscode.commands.registerCommand(cmd, () => {
          showTerminalBlockedMessage();
        })
      );
      console.log(`[OpenAgentic] Registered override for: ${cmd}`);
    } catch (err) {
      // Expected - can't override built-in commands
      // The keybindings.json and SHELL=/bin/false handle this case
      console.log(`[OpenAgentic] Could not override ${cmd} (expected for built-in commands)`);
    }
  }
}

/**
 * Hide the terminal panel if it exists and is visible
 */
async function hideTerminalPanel(): Promise<void> {
  try {
    // Close all terminal instances
    vscode.window.terminals.forEach(terminal => {
      terminal.dispose();
    });

    // Hide the panel (where terminal lives)
    await vscode.commands.executeCommand('workbench.action.closePanel');
    console.log('[OpenAgentic] Terminal panel hidden');
  } catch (err) {
    // Ignore errors - panel might not exist
  }
}

// ========================================
// Extension Activation
// ========================================

let chatProvider: OpenagenticChatViewProvider | null = null;
let activityProvider: ActivityViewProvider | null = null;

/**
 * Get the currently selected code in the active editor
 */
function getSelectedCode(): { code: string; language: string; fileName: string } | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('No active editor');
    return null;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showWarningMessage('No code selected');
    return null;
  }

  const code = editor.document.getText(selection);
  const language = editor.document.languageId;
  const fileName = editor.document.fileName.split('/').pop() || 'unknown';

  return { code, language, fileName };
}

/**
 * Send a code-related prompt to the AI chat
 */
function sendCodePrompt(prompt: string, code: string, language: string): void {
  // Focus the chat panel first
  vscode.commands.executeCommand('openagentic.chatView.focus');

  // Send the message via the chat provider
  if (chatProvider) {
    const fullPrompt = `${prompt}\n\n\`\`\`${language}\n${code}\n\`\`\``;
    chatProvider.sendMessageFromExtension(fullPrompt);
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log('OpenAgentic AI Extension activating...');

  // ========================================
  // SECURITY: Block terminal access first
  // ========================================
  // This is a critical security feature for Code Mode
  // Users should use the AI assistant, not direct terminal access
  registerTerminalBlockingCommands(context);

  // Hide terminal panel on startup (in case it was open from previous session)
  hideTerminalPanel();

  // Watch for new terminals being created and dispose them immediately
  context.subscriptions.push(
    vscode.window.onDidOpenTerminal((terminal) => {
      console.log('[OpenAgentic] Terminal opened, disposing immediately for security');
      showTerminalBlockedMessage();
      // Dispose after a short delay to ensure the message is shown
      setTimeout(() => terminal.dispose(), 100);
    })
  );

  // Register chat view provider
  chatProvider = new OpenagenticChatViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('openagentic.chatView', chatProvider)
  );

  // Register activity view provider
  activityProvider = new ActivityViewProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('openagentic.activity', activityProvider)
  );

  // Register basic commands
  context.subscriptions.push(
    vscode.commands.registerCommand('openagentic.openChat', () => {
      vscode.commands.executeCommand('openagentic.chatView.focus');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openagentic.clearActivity', () => {
      activityProvider?.clear();
    })
  );

  // Register code action commands
  context.subscriptions.push(
    vscode.commands.registerCommand('openagentic.explainCode', () => {
      const selected = getSelectedCode();
      if (selected) {
        sendCodePrompt(
          `Please explain this ${selected.language} code from ${selected.fileName}. What does it do, and are there any potential issues?`,
          selected.code,
          selected.language
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openagentic.refactorCode', () => {
      const selected = getSelectedCode();
      if (selected) {
        sendCodePrompt(
          `Please refactor this ${selected.language} code to improve readability, performance, and maintainability. Show me the improved version with explanations.`,
          selected.code,
          selected.language
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openagentic.generateTests', () => {
      const selected = getSelectedCode();
      if (selected) {
        sendCodePrompt(
          `Please generate comprehensive unit tests for this ${selected.language} code. Include edge cases and ensure good coverage.`,
          selected.code,
          selected.language
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openagentic.fixCode', () => {
      const selected = getSelectedCode();
      if (selected) {
        sendCodePrompt(
          `Please analyze this ${selected.language} code for bugs, errors, and potential issues. Fix any problems you find and explain what was wrong.`,
          selected.code,
          selected.language
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openagentic.addDocumentation', () => {
      const selected = getSelectedCode();
      if (selected) {
        sendCodePrompt(
          `Please add comprehensive documentation to this ${selected.language} code. Include JSDoc/docstrings, inline comments for complex logic, and usage examples.`,
          selected.code,
          selected.language
        );
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('openagentic.askAboutCode', async () => {
      const selected = getSelectedCode();
      if (selected) {
        const question = await vscode.window.showInputBox({
          prompt: 'What would you like to know about this code?',
          placeHolder: 'e.g., How can I optimize this? What design pattern is used here?'
        });

        if (question) {
          sendCodePrompt(
            `${question}\n\nHere's the ${selected.language} code from ${selected.fileName}:`,
            selected.code,
            selected.language
          );
        }
      }
    })
  );

  // Show welcome (silent - don't spam user)
  console.log('OpenAgentic AI Extension activated');
}

export function deactivate() {
  console.log('OpenAgentic AI Extension deactivated');
}
