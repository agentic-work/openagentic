export class TokenCounter {
  private static readonly CHARS_PER_TOKEN = 3.5;
  private static readonly MESSAGE_OVERHEAD = 10;

  estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / TokenCounter.CHARS_PER_TOKEN);
  }

  countMessage(message: any): number {
    const content = message.content || '';
    const contentLen = typeof content === 'string' ? content.length : JSON.stringify(content).length;
    let tokens = Math.ceil(contentLen / TokenCounter.CHARS_PER_TOKEN) + TokenCounter.MESSAGE_OVERHEAD;

    if (message.toolCalls || message.tool_calls) {
      const toolCalls = message.toolCalls || message.tool_calls;
      const toolCallStr = JSON.stringify(toolCalls);
      tokens += Math.ceil(toolCallStr.length / TokenCounter.CHARS_PER_TOKEN);
    }

    return tokens;
  }

  countToolDefinition(tool: any): number {
    const str = JSON.stringify(tool);
    return Math.ceil(str.length / TokenCounter.CHARS_PER_TOKEN);
  }

  countSystemPrompt(prompt: string): number {
    return this.estimateTokens(prompt) + TokenCounter.MESSAGE_OVERHEAD;
  }

  countMessages(messages: any[]): number {
    return messages.reduce((sum, msg) => sum + this.countMessage(msg), 0);
  }
}
