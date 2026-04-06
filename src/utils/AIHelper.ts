import { AIProvider, AIMessage } from '../core/base.js';

export class AIHelper {
  static async getJsonResponse<T>(
    aiProvider: AIProvider,
    prompt: string | AIMessage[],
    systemInstruction?: string,
    fallback: T = {} as T
  ): Promise<T> {
    try {
      const response = await aiProvider.generateContent(prompt, [], systemInstruction);
      const content = response.content;
      
      // Attempt to extract JSON from markdown or raw text
      // We try to find the longest JSON-like block (usually the main result)
      const matches = content.match(/\[[\s\S]*\]|\{[\s\S]*\}/g);
      if (matches) {
        // Try parsing each match, starting from the last one (often models put reasoning first, then JSON)
        for (let i = matches.length - 1; i >= 0; i--) {
          try {
            return JSON.parse(matches[i]);
          } catch {
            continue;
          }
        }
      }
      return JSON.parse(content);
    } catch (e) {
      console.warn('[AIHelper] Failed to parse JSON response, returning fallback:', e);
      return fallback;
    }
  }

  static cleanInput(input: string): string {
    return input.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').trim();
  }

  static getDatePrompt(): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-CN', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric', 
      weekday: 'long' 
    });
    const timeStr = now.toLocaleTimeString('zh-CN', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
    return `### 当前时间上下文：\n- 今天是：${dateStr}\n- 当前时刻：${timeStr}\n\n`;
  }
}
