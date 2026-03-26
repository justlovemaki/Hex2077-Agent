import OpenAI from 'openai';
import { Hex2077Tool } from './Hex2077Tool.js';
import { ServiceContext, LogService, AIProvider, KnowledgeBaseService, AIResponse, AIMessage } from './base.js';

/**
 * 1. 实现一个真实的 OpenAI 提供商
 * 你可以根据自己的需求替换为 Gemini, Claude, Ollama 等
 */
class RealOpenAIProvider implements AIProvider {
  name = 'OpenAI';
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, baseURL?: string, model: string = 'gpt-4o') {
    this.client = new OpenAI({ apiKey, baseURL });
    this.model = model;
  }

  async generateContent(prompt: string | AIMessage[], tools: any[], systemInstruction?: string): Promise<AIResponse> {
    const messages: any[] = [];
    
    // 注入系统指令
    if (systemInstruction) {
      messages.push({ role: 'system', content: systemInstruction });
    }

    // 注入用户输入
    if (typeof prompt === 'string') {
      messages.push({ role: 'user', content: prompt });
    } else {
      messages.push(...prompt);
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages,
      tools: tools.length > 0 ? (tools as any) : undefined,
      temperature: 0.7,
    });

    return {
      content: response.choices[0].message.content || ''
    };
  }
}

/**
 * 2. 简单的知识库实现（或者直接返回空字符串）
 */
class SimpleKBService implements KnowledgeBaseService {
  async queryKnowledge(query: string): Promise<string> {
    // 这里可以对接向量数据库（如 Pinecone, Milvus）或本地 FTS5 搜索
    return ""; 
  }
}

/**
 * 3. 配置并启动
 */
async function run() {
  const context: ServiceContext = {
    // 配置你的 API Key 和代理地址
    aiProvider: new RealOpenAIProvider(
      'your-api-key-here',
      'https://api.openai.com/v1',
      'gpt-4o'
    ),
    knowledgeBaseService: new SimpleKBService()
  };

  const tool = new Hex2077Tool(context, console as any);
  
  const result = await tool.handler({ input: 'AI Coding 现在的瓶颈在哪里？' });
  console.log('何夕2077 回答：', result.content);
}

// run().catch(console.error); // 填入 API Key 后取消注释即可运行
