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
      const jsonMatch = content.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
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
