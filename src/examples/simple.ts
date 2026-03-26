import { Hex2077Tool } from '../tools/Hex2077Tool.js';
import { ServiceContext, LogService, AIProvider, KnowledgeBaseService, AIResponse, AIMessage } from '../core/base.js';

// 1. 实现一个简单的 Mock AI 提供者
class MockAIProvider implements AIProvider {
  name = 'MockProvider';
  async generateContent(prompt: string | AIMessage[], tools: any[], systemInstruction?: string): Promise<AIResponse> {
    console.log(`[AI] Received Prompt: ${typeof prompt === 'string' ? prompt.slice(0, 100) : 'Complex Messages'}`);
    console.log(`[AI] System Instruction: ${systemInstruction?.slice(0, 100)}...`);
    console.log(`[AI] Tools: ${JSON.stringify(tools)}`);
    
    // 模拟不同 Agent 的返回
    if (systemInstruction?.includes('策略师')) {
      return { content: '[Strategy: 类型A]' };
    }
    if (systemInstruction?.includes('风格执行者')) {
      return { content: '这是何夕2077风格的回答。⚡' };
    }
    
    return { content: '这是模拟的干货内容。' };
  }
}

// 2. 实现一个简单的 Mock 知识库服务
class MockKBService implements KnowledgeBaseService {
  async queryKnowledge(query: string): Promise<string> {
    return `关于 "${query}" 的知识库内容：这里是一些模拟的文档事实。`;
  }
}

// 3. 实现一个简单的 Mock 日志服务
class MockLogger implements LogService {
  info(msg: string) { console.log(`[INFO] ${msg}`); }
  error(msg: string) { console.error(`[ERROR] ${msg}`); }
  warn(msg: string) { console.warn(`[WARN] ${msg}`); }
}

// 4. 运行示例
async function main() {
  const context: ServiceContext = {
    aiProvider: new MockAIProvider(),
    knowledgeBaseService: new MockKBService()
  };
  const logger = new MockLogger();

  const tool = new Hex2077Tool(context, logger);
  
  console.log('--- 开始运行何夕2077 6-Agent 编排 ---');
  const result = await tool.handler({ input: '如何看待 AI Coding 的未来？' });
  
  console.log('\n--- 最终输出 ---');
  console.log('策略:', result.strategy);
  console.log('内容:', result.content);
  console.log('执行步骤数:', result.steps.length);
}

main().catch(console.error);
