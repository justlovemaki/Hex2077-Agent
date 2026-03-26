import { Hex2077Tool } from '../tools/Hex2077Tool.js';
import { ServiceContext, KnowledgeBaseService } from '../core/base.js';
import { OpenAIProvider } from '../providers/OpenAIProvider.js';

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
    aiProvider: new OpenAIProvider(
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
