import OpenAI from 'openai';
import { AIProvider, AIMessage, AIResponse } from '../core/base.js';
import { AIHelper } from '../utils/AIHelper.js';

export class OpenAIProvider implements AIProvider {
  name = 'OpenAIProvider';
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, baseURL?: string, model: string = 'gpt-4o') {
    this.client = new OpenAI({ apiKey, baseURL });
    this.model = model;
  }

  async generateContent(prompt: string | AIMessage[], tools: any[], systemInstruction?: string): Promise<AIResponse> {
    const messages = this.formatMessages(prompt, systemInstruction);
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages,
      tools: tools.length > 0 ? (tools as any) : undefined,
      temperature: 0.7,
    });
    return { content: response.choices[0].message.content || '' };
  }

  async *generateStream(prompt: string | AIMessage[], tools: any[], systemInstruction?: string): AsyncIterable<string> {
    const messages = this.formatMessages(prompt, systemInstruction);
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: messages,
      tools: tools.length > 0 ? (tools as any) : undefined,
      temperature: 0.7,
      stream: true,
    });
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) yield content;
    }
  }

  private formatMessages(prompt: string | AIMessage[], systemInstruction?: string): any[] {
    const messages: any[] = [];
    
    // 注入当前日期上下文到系统提示词中
    const dateCtx = AIHelper.getDatePrompt();
    const finalSystem = systemInstruction ? `${dateCtx}${systemInstruction}` : dateCtx;
    
    messages.push({ role: 'system', content: finalSystem });

    if (typeof prompt === 'string') {
      messages.push({ role: 'user', content: prompt });
    } else {
      // 过滤掉客户端带过来的 system 消息，避免多 system 提示词冲突导致大模型逻辑和角色混乱
      const formattedHistory = prompt
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role, content: m.content }));
      messages.push(...formattedHistory);
    }
    return messages;
  }
}
